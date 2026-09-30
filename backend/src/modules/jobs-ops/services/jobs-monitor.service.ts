import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { recordJobEvent } from '@packages/messaging/index.js';
import { JobMonitoringService, type JobRecord } from '@packages/queue/index.js';
import { JobsOpsService } from './jobs-ops.service.js';
import { JobsMetricsService } from './jobs-metrics.service.js';

const TICK_MS = 30_000;
const ACTIVE_SCAN = 200;
/** Mỗi job chỉ ghi sự kiện stalled / chạy lâu một lần trong khoảng này. */
const SEEN_TTL_SEC = 6 * 3600;

/**
 * Chạy nền trong API (một instance mỗi chu kỳ nhờ lock Redis): phát hiện job đang chạy mất heartbeat (stalled) hoặc
 * chạy lâu bất thường → ghi sự kiện một lần cho mỗi job; dọn chỉ mục bản ghi huỷ đã hết hạn.
 */
@Injectable()
export class JobsMonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('JobsMonitor');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly jobs: JobMonitoringService,
    private readonly ops: JobsOpsService,
    private readonly metrics: JobsMetricsService,
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
  ) {}

  public onApplicationBootstrap(): void {
    if (this.config.isTest) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public async tick(now = Date.now()): Promise<void> {
    if (this.running || !this.redis.isReady() || !this.jobs.usable()) return;
    this.running = true;
    try {
      const locked = await this.redis.client.set(
        this.jobs.keys.monitorLock(),
        String(now),
        'PX',
        TICK_MS - 1000,
        'NX',
      );
      if (locked !== 'OK') return;
      await this.detect(now);
      await this.jobs.pruneCancelled(now);
    } catch (err) {
      this.logger.warn(
        `Jobs monitor tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async detect(now: number): Promise<void> {
    const active = (
      await Promise.all(
        this.jobs.provider
          .queues()
          .map((q) => this.jobs.provider.list(q, 'active', 0, ACTIVE_SCAN, true)),
      )
    ).flat();
    if (!active.length) return;
    const typical = await this.metrics.typicalByType(now).catch(() => new Map<string, number>());
    for (const j of active) {
      if (j.status === 'stalled') {
        await this.once('stalled', j, 'job_stalled', {
          detector: 'monitor',
          ...(j.worker ? { worker: j.worker } : {}),
        });
        continue;
      }
      const runningMs = j.startedAt !== null ? now - j.startedAt : 0;
      const typ = typical.get(j.type) ?? null;
      if (runningMs > this.ops.longRunningThreshold(typ))
        await this.once('long', j, 'job_long_running', {
          minutes: Math.max(1, Math.round(runningMs / 60_000)),
          ...(typ !== null ? { typicalSec: Math.round(typ / 1000) } : {}),
        });
    }
  }

  private async once(
    kind: string,
    j: JobRecord,
    type: 'job_stalled' | 'job_long_running',
    params: Record<string, string | number>,
  ): Promise<void> {
    const first = await this.redis.client.set(
      this.jobs.keys.seen(kind, j.queue, j.id),
      '1',
      'EX',
      SEEN_TTL_SEC,
      'NX',
    );
    if (first !== 'OK') return;
    await recordJobEvent(this.redis, {
      type,
      severity: 'warning',
      jobId: j.id,
      queue: j.queue,
      jobType: j.type,
      params,
      runtime: 'api',
    });
  }
}

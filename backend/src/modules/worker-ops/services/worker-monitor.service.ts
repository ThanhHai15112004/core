import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  MessagingConnectionService,
  MessagingMonitoringService,
  messagingKeys,
  type ConsumerRegistration,
  type MessagingErrorRecord,
} from '@packages/messaging/index.js';
import {
  QueueMonitoringService,
  recordQueueEvent,
  type JobSummary,
  type QueueInfo,
} from '@packages/queue/index.js';
import { WorkerMetricsService } from './worker-metrics.service.js';
import { WorkerStoreService } from './worker-store.service.js';
import {
  diffWorkerAlerts,
  evaluateWorkerRules,
  type QueueRuleInput,
  type WorkerViolation,
} from './worker-rules.js';
import { MINUTE, reasonOf, waitingOf } from './worker-utils.js';

const TICK_MS = 15_000;
const RULE_WINDOW_MS = 15 * MINUTE;
/** Số job active tối đa đọc để tìm job treo. */
const STALLED_SCAN = 200;

/** Concurrency cấu hình của các worker (không paused) đang tiêu thụ queue. */
export const concurrencyOf = (consumers: ConsumerRegistration[], queue: string) =>
  consumers.filter((c) => c.queue === queue && !c.paused).reduce((s, c) => s + c.concurrency, 0);

/** Job active chạy lâu hơn `stalledMin` (phút) — mới nhất ở cuối. */
export function stalledJobs(active: JobSummary[], stalledMin: number, now: number): JobSummary[] {
  return active
    .filter((j) => j.processedAt !== null && now - j.processedAt >= stalledMin * MINUTE)
    .sort((a, b) => a.processedAt! - b.processedAt!);
}

/** Lý do lỗi xuất hiện nhiều nhất trong danh sách lỗi consume. */
export function primaryReason(errors: readonly MessagingErrorRecord[]): string | null {
  const counts = new Map<string, number>();
  for (const e of errors) {
    const r = e.code ?? reasonOf(e.message);
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Chạy nền trong API (một instance mỗi chu kỳ nhờ lock Redis): chụp độ sâu từng queue để vẽ lịch sử
 * (waiting/active/delayed/failed, worker), tìm job treo, đo retry storm và đánh giá cảnh báo công việc nền.
 */
@Injectable()
export class WorkerMonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('WorkerMonitor');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly connection: MessagingConnectionService,
    private readonly queues: QueueMonitoringService,
    private readonly messaging: MessagingMonitoringService,
    private readonly metrics: WorkerMetricsService,
    private readonly store: WorkerStoreService,
    private readonly config: CoreConfigService,
    private readonly redis: RedisService,
  ) {}

  public onApplicationBootstrap(): void {
    if (this.config.isTest) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
    setTimeout(() => void this.tick(), 6000).unref();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public async tick(now = Date.now()): Promise<void> {
    if (this.running || !this.store.isAvailable()) return;
    this.running = true;
    try {
      const locked = await this.store.client.set(
        this.store.keys.collectLock(),
        String(now),
        'PX',
        TICK_MS - 1000,
        'NX',
      );
      if (locked !== 'OK') return;
      const usable = this.queues.usable();
      const [queues, active] = usable
        ? await Promise.all([
            this.queues.provider.queues().catch((err) => {
              this.logger.warn(
                `Queue snapshot failed: ${err instanceof Error ? err.message : err}`,
              );
              return null;
            }),
            this.queues.provider.jobs(null, ['active'], STALLED_SCAN).catch(() => null),
          ])
        : [null, null];
      const consumers = await this.messaging.consumers().catch(() => [] as ConsumerRegistration[]);
      if (queues) this.record(queues);
      await this.evaluate(queues, active, consumers, now);
    } catch (err) {
      this.logger.warn(
        `Worker monitor tick failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private record(queues: QueueInfo[]): void {
    this.metrics.recordQueues(queues);
  }

  private async recentErrors(since: number): Promise<MessagingErrorRecord[]> {
    const raws = await this.redis.client
      .lrange(messagingKeys(this.redis).errors(), 0, 199)
      .catch(() => [] as string[]);
    return raws
      .map((r) => {
        try {
          return JSON.parse(r) as MessagingErrorRecord;
        } catch {
          return null;
        }
      })
      .filter(
        (e): e is MessagingErrorRecord => e !== null && e.stage === 'consume' && e.at >= since,
      );
  }

  private async evaluate(
    queues: QueueInfo[] | null,
    active: JobSummary[] | null,
    consumers: ConsumerRegistration[],
    now: number,
  ): Promise<void> {
    const rules = this.config.queue.rules;
    const [win, minuteWin, alerts] = await Promise.all([
      this.metrics.window(now - RULE_WINDOW_MS, now, now),
      this.metrics.window(now - MINUTE, now, now),
      this.store.activeAlerts(),
    ]);
    const queueInputs: QueueRuleInput[] | null = queues
      ? queues.map((q) => {
          const c = this.metrics.counts(win, q.name);
          return {
            name: q.name,
            waiting: waitingOf(q),
            active: q.counts.active,
            paused: q.paused,
            workers: q.workers?.length ?? null,
            concurrency: concurrencyOf(consumers, q.name),
            oldestWaitingMin:
              q.oldestWaitingAt === null ? null : (now - q.oldestWaitingAt) / MINUTE,
            ops: c.completed + c.failed,
            failureRatePercent: c.failureRatePercent,
            p95Ms: this.metrics.processing(win, q.name).p95Ms,
          };
        })
      : null;
    const stalled = active ? stalledJobs(active, rules.stalledMin, now) : [];
    const retriesPerMin = this.metrics.counts(minuteWin).retried;
    const topRetryQueue =
      queues
        ?.map((q) => ({ q: q.name, n: this.metrics.counts(minuteWin, q.name).retried }))
        .sort((a, b) => b.n - a.n)[0] ?? null;
    const primary =
      retriesPerMin >= rules.retryStormPerMin
        ? primaryReason(await this.recentErrors(now - MINUTE))
        : null;
    const violations = evaluateWorkerRules(
      {
        connection: this.connection.getStatus().state,
        queues: queueInputs,
        stalled: stalled.length
          ? {
              count: stalled.length,
              oldestMin: (now - stalled[0]!.processedAt!) / MINUTE,
              queue: stalled[0]!.queue,
            }
          : null,
        retries: {
          perMin: retriesPerMin,
          queue: topRetryQueue && topRetryQueue.n > 0 ? topRetryQueue.q : null,
          error: primary,
        },
      },
      rules,
    );
    await this.applyAlerts(violations, alerts, now);
  }

  private async applyAlerts(
    violations: WorkerViolation[],
    active: Awaited<ReturnType<WorkerStoreService['activeAlerts']>>,
    now: number,
  ): Promise<void> {
    const { started, set, recovered } = diffWorkerAlerts(violations, active, now);
    const key = this.store.keys.activeAlerts();
    const pipe = this.store.client.pipeline();
    for (const [id, state] of set) pipe.hset(key, id, JSON.stringify(state));
    if (recovered.length) pipe.hdel(key, ...recovered.map((r) => r.id));
    await pipe.exec();
    for (const v of started) {
      if (v.severity === 'info') continue;
      await recordQueueEvent(this.redis, {
        type: 'alert_started',
        severity: v.severity,
        params: { rule: v.id, value: v.value, threshold: v.threshold, unit: v.unit, ...v.extra },
        runtime: null,
        at: now,
      });
    }
    for (const r of recovered) {
      if (r.alert.severity === 'info') continue;
      await recordQueueEvent(this.redis, {
        type: 'alert_recovered',
        severity: 'success',
        params: {
          rule: r.id,
          minutes: Math.max(1, Math.round(r.durationMs / MINUTE)),
          ...r.alert.extra,
        },
        runtime: null,
        at: now,
      });
    }
  }
}

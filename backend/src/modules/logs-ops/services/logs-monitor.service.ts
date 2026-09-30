import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { RedisService } from '@packages/redis/index.js';
import { LOG_INGEST_TTL_MS } from '@packages/runtime/index.js';
import { LogsStoreService } from './logs-store.service.js';

const TICK_MS = 60_000;
const LOCK_SEC = 50;

/**
 * Việc nền của Logs (một instance API mỗi chu kỳ): dọn nhóm lỗi quá hạn / vượt số lượng, bỏ level tạm thời đã hết hạn
 * (ghi audit "tự hết hạn"), dọn tình trạng ghi của instance đã dừng.
 */
@Injectable()
export class LogsMonitorService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LogsMonitorService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly redis: RedisService,
    private readonly store: LogsStoreService,
  ) {}

  public onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref();
  }

  public onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Một chu kỳ (public để test). */
  public async tick(now = Date.now()): Promise<void> {
    if (!this.redis.isReady()) return;
    const lock = await this.redis.client
      .set(this.redis.key('logs', 'lock', 'monitor'), String(now), 'EX', LOCK_SEC, 'NX')
      .catch(() => null);
    if (lock !== 'OK') return;
    try {
      await this.store.pruneGroups(now);
      for (const runtime of await this.store.expireOverrides(now))
        await this.store.recordOperation({
          at: now,
          action: 'level_revert',
          target: runtime,
          result: 'success',
          detail: 'expired',
          durationMs: 0,
          actor: 'system',
          ip: null,
          error: null,
        });
      await this.store.pruneIngest(LOG_INGEST_TTL_MS * 10, now);
    } catch (err) {
      this.logger.warn({
        message: 'Logs maintenance failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

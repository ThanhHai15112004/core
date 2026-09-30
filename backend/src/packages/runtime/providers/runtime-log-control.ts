import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { RedisService } from '@packages/redis/index.js';
import {
  CoreLoggerService,
  LogLevel,
  logsKeys,
  type LogIngestState,
  type LogLevelOverrideRecord,
} from '@packages/logging/index.js';
import { RUNTIME_IDENTITY } from '../constants/runtime.tokens.js';
import type { RuntimeIdentity } from '../contracts/runtime.types.js';
import { RuntimeLogSink } from './runtime-log.sink.js';

const SYNC_INTERVAL_MS = 5000;
/** Tình trạng ghi log của instance không còn báo sau chừng này thì bị coi là đã dừng. */
export const LOG_INGEST_TTL_MS = 60_000;

/**
 * Nhận level tạm thời do System Console đặt (Redis `logs:level`) và tự hết hạn; báo tình trạng ghi log của instance
 * (lần ghi thành công cuối, số log mất, level đang áp dụng) để trang Logs nói thật về pipeline.
 */
@Injectable()
export class RuntimeLogControl implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private applied: string | null = null;

  constructor(
    @Inject(RUNTIME_IDENTITY) private readonly identity: RuntimeIdentity,
    private readonly redis: RedisService,
    private readonly logger: CoreLoggerService,
    private readonly sink: RuntimeLogSink,
  ) {}

  public onApplicationBootstrap(): void {
    if (this.identity.kind !== 'long-running') return;
    void this.sync();
    this.timer = setInterval(() => void this.sync(), SYNC_INTERVAL_MS);
    this.timer.unref();
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.redis.isReady()) return;
    await this.redis.client
      .hdel(logsKeys(this.redis).ingest(), `${this.identity.id}@${this.sink.instanceName}`)
      .catch(() => undefined);
  }

  /** Một chu kỳ (public để test). */
  public async sync(now = Date.now()): Promise<void> {
    if (!this.redis.isReady()) return;
    const k = logsKeys(this.redis);
    try {
      const raw = await this.redis.client.hget(k.level(), this.identity.id);
      this.apply(raw, now);
      const override = this.logger.getOverride();
      const stats = this.logger.getStats();
      const state: LogIngestState = {
        runtime: this.identity.id,
        instance: this.sink.instanceName,
        lastSuccessAt: this.sink.lastSuccessAt,
        lastErrorAt: this.sink.lastErrorAt,
        lastError: this.sink.lastError,
        dropped: this.sink.dropped,
        level: this.logger.getLogLevel(),
        baseLevel: this.logger.getBaseLevel(),
        overrideUntil: override?.until ?? null,
        overrideModules: override?.modules ?? [],
        suppressed: stats.suppressed,
        written: stats.written,
        redacted: stats.redacted,
        updatedAt: now,
      };
      await this.redis.client.hset(
        k.ingest(),
        `${this.identity.id}@${this.sink.instanceName}`,
        JSON.stringify(state),
      );
    } catch {
      // Redis lỗi: giữ level hiện tại; level tạm thời vẫn tự hết hạn trong logger.
    }
  }

  private apply(raw: string | null, now: number): void {
    if (raw === this.applied) return;
    this.applied = raw;
    if (!raw) {
      this.logger.setOverride(null);
      return;
    }
    try {
      const rec = JSON.parse(raw) as LogLevelOverrideRecord;
      if (rec.until !== null && rec.until <= now) {
        this.logger.setOverride(null);
        return;
      }
      this.logger.setOverride({
        level: rec.level as LogLevel,
        until: rec.until,
        modules: rec.modules ?? [],
      });
    } catch {
      this.logger.setOverride(null);
    }
  }
}

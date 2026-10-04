import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { hostname } from 'node:os';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { logsKeys } from '../constants/logs.keys.js';
import type { LogIngestState, LogLevelOverrideRecord } from '../contracts/log-store.types.js';
import { LOGGING_OPTIONS, type LoggingModuleOptions } from '../contracts/logging-options.js';
import { PINO_LEVEL, getRootLogger, redisStream } from './pino-root.logger.js';

const SYNC_MS = 5_000;
const LABEL_OF: Record<string, string> = Object.fromEntries(
  Object.entries(PINO_LEVEL).map(([label, pinoLevel]) => [pinoLevel, label]),
);

/**
 * Level log của runtime: gốc từ `LOG_LEVEL`, System Console đặt level tạm thời qua hash Redis `logs:level`
 * (runtime tự đọc mỗi 5 giây, tự hết hạn). Đồng thời gắn Redis Stream cho pino và báo tình trạng ghi log.
 */
@Injectable()
export class LogLevelService implements OnApplicationBootstrap, OnApplicationShutdown {
  private baseLevel: string;
  private override: LogLevelOverrideRecord | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly instance = `${hostname()}:${process.pid}`;

  constructor(
    @Inject(LOGGING_OPTIONS) private readonly options: LoggingModuleOptions,
    private readonly redis: RedisService,
    private readonly config: CoreConfigService,
  ) {
    this.baseLevel = config.logs.level;
  }

  public onApplicationBootstrap(): void {
    redisStream.attach(this.redis, logsKeys(this.redis).stream(this.config.app.env));
    if (this.options.runtime === 'cli') return;
    void this.sync();
    this.timer = setInterval(() => void this.sync(), SYNC_MS);
    this.timer.unref();
  }

  public async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await redisStream.flush();
    if (this.options.runtime !== 'cli' && this.redis.isReady())
      await this.redis.client.hdel(logsKeys(this.redis).ingest(), this.ingestField).catch(() => 0);
    redisStream.detach(this.redis);
  }

  /** Level đang áp dụng (`INFO`, `DEBUG`…). */
  public current(): string {
    const lvl = getRootLogger()?.level;
    return (lvl && LABEL_OF[lvl]) || this.baseLevel;
  }

  public getBaseLevel(): string {
    return this.baseLevel;
  }

  /** Đổi level gốc của process này (action trong Packages). */
  public setBaseLevel(level: string): void {
    this.baseLevel = PINO_LEVEL[level] ? level : 'INFO';
    this.apply();
  }

  private get ingestField(): string {
    return `${this.options.runtime}@${this.instance}`;
  }

  private apply(now = Date.now()): void {
    const o = this.override;
    const active = o && (o.until === null || o.until > now) ? o : null;
    const root = getRootLogger();
    if (root) root.level = PINO_LEVEL[active?.level ?? this.baseLevel] ?? 'info';
  }

  /** Đọc level tạm thời và ghi tình trạng ghi log (public để test). */
  public async sync(now = Date.now()): Promise<void> {
    if (!this.redis.isReady()) return;
    const k = logsKeys(this.redis);
    try {
      const raw = await this.redis.client.hget(k.level(), this.options.runtime);
      this.override = raw ? (JSON.parse(raw) as LogLevelOverrideRecord) : null;
      this.apply(now);
      const state: LogIngestState = {
        runtime: this.options.runtime,
        instance: this.instance,
        lastSuccessAt: redisStream.lastSuccessAt,
        lastErrorAt: redisStream.lastErrorAt,
        lastError: redisStream.lastError,
        dropped: redisStream.dropped,
        level: this.current(),
        baseLevel: this.baseLevel,
        overrideUntil: this.override?.until ?? null,
        overrideModules: this.override?.modules ?? [],
        suppressed: 0,
        written: redisStream.written,
        redacted: 0,
        updatedAt: now,
      };
      await this.redis.client.hset(k.ingest(), this.ingestField, JSON.stringify(state));
    } catch {
      // Không đọc được level tạm thời: giữ level hiện tại.
    }
  }
}

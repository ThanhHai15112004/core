import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis, RedisOptions } from 'ioredis';
import type { ConnectionOptions } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import { REDIS_CLIENT_FACTORY, type RedisClientFactory } from './redis.constants.js';

const MAX_RETRY_DELAY_MS = 5000;

/**
 * Kết nối Redis dùng chung cho mọi runtime.
 * Redis có thể dùng chung với project khác nên MỌI key phải đi qua `key()` để có `REDIS_PREFIX`,
 * và không bao giờ dùng lệnh xoá toàn bộ DB.
 * Mất kết nối không làm crash app: lệnh sẽ lỗi nhanh và caller hiểu là "không có telemetry".
 */
@Injectable()
export class RedisService implements OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  private readonly options: RedisOptions;
  private readonly prefix: string;
  private readonly subscribers: Redis[] = [];
  private lastError: string | null = null;
  public readonly client: Redis;

  constructor(
    config: CoreConfigService,
    @Inject(REDIS_CLIENT_FACTORY) private readonly factory: RedisClientFactory,
  ) {
    const { host, port, password, db, prefix } = config.cache.redis;
    this.prefix = prefix;
    this.options = {
      host,
      port,
      db,
      ...(password ? { password } : {}),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 500, MAX_RETRY_DELAY_MS),
    };
    this.client = this.createClient();
  }

  public isReady(): boolean {
    return this.client.status === 'ready';
  }

  /** Đợi kết nối sẵn sàng tối đa `timeoutMs`; trả về có sẵn sàng hay không. */
  public waitUntilReady(timeoutMs: number): Promise<boolean> {
    if (this.isReady()) return Promise.resolve(true);
    return new Promise((resolve) => {
      const done = (ready: boolean) => {
        clearTimeout(timer);
        this.client.off('ready', onReady);
        resolve(ready);
      };
      const onReady = () => done(true);
      const timer = setTimeout(() => done(this.isReady()), timeoutMs);
      this.client.once('ready', onReady);
    });
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  /** Ghép key có prefix, vd. `key('runtime', 'hb', 'api')` → `core:runtime:hb:api`. */
  public key(...parts: string[]): string {
    return `${this.prefix}${parts.join(':')}`;
  }

  /** Prefix cho BullMQ (BullMQ tự thêm `:<queue>:...`). */
  public bullPrefix(): string {
    return `${this.prefix}bull`;
  }

  /** Options kết nối cho BullMQ (BullMQ yêu cầu `maxRetriesPerRequest: null`). */
  public bullConnection(): ConnectionOptions {
    const { host, port, db, password } = this.options;
    return {
      host,
      port,
      db,
      ...(password ? { password } : {}),
      maxRetriesPerRequest: null,
      retryStrategy: (times: number) => Math.min(times * 500, MAX_RETRY_DELAY_MS),
    };
  }

  /** Client riêng cho pub/sub (client đã SUBSCRIBE không chạy được lệnh thường). */
  public createSubscriber(): Redis {
    const sub = this.createClient({ enableOfflineQueue: true });
    this.subscribers.push(sub);
    return sub;
  }

  /** Đóng ở pha cuối để các provider khác còn ghi được sự kiện lúc shutdown. */
  public async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.client, ...this.subscribers].map((c) => c.quit()));
  }

  private createClient(overrides: Partial<RedisOptions> = {}): Redis {
    const client = this.factory({ ...this.options, ...overrides });
    client.on('ready', () => {
      if (this.lastError) this.logger.log('Redis connection restored');
      this.lastError = null;
    });
    client.on('error', (err: Error) => {
      // Chỉ log khi lỗi đổi để tránh spam log mỗi lần retry.
      if (this.lastError !== err.message) {
        this.logger.warn(`Redis unavailable: ${err.message}`);
      }
      this.lastError = err.message;
    });
    client.connect().catch(() => undefined);
    return client;
  }
}

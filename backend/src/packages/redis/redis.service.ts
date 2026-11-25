import { performance } from 'node:perf_hooks';
import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown } from '@nestjs/common';
import type { Redis, RedisOptions } from 'ioredis';
import type { ConnectionOptions } from 'bullmq';
import { CoreConfigService } from '@packages/config/index.js';
import { RUNTIME_IDENTITY } from '@packages/runtime/constants/runtime.tokens.js';
import { REDIS_CLIENT_FACTORY, type RedisClientFactory } from './redis.constants.js';

const MAX_RETRY_DELAY_MS = 5000;
const MAX_LATENCY_SAMPLES = 200;

const TRACKED_COMMANDS = new Set([
  'get',
  'set',
  'del',
  'hget',
  'hset',
  'hgetall',
  'lpush',
  'rpush',
  'xadd',
  'xrange',
  'scan',
  'info',
  'ping',
  'eval',
  'exec',
]);

export type RedisLatencyObserver = (operation: string, durationMs: number) => void;

export interface RedisLatencySnapshot {
  count: number;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  lastPingMs: number | null;
}

function normalizeRedisCommand(name: unknown): string {
  const op = typeof name === 'string' ? name.toLowerCase() : 'other';
  return TRACKED_COMMANDS.has(op) ? op : 'other';
}

function quantile(sorted: readonly number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  const val = sorted[idx];
  return val === undefined ? null : Math.round(val * 100) / 100;
}

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
  private readonly latencySamples: number[] = [];
  private readonly latencyObservers = new Set<RedisLatencyObserver>();
  private lastPingMs: number | null = null;
  private lastError: string | null = null;
  public readonly client: Redis;
  /** Tên kết nối `core-<runtime>` (CLIENT SETNAME). */
  public readonly clientName: string;

  constructor(
    config: CoreConfigService,
    @Inject(REDIS_CLIENT_FACTORY) private readonly factory: RedisClientFactory,
    @Optional() @Inject(RUNTIME_IDENTITY) identity?: { id: string },
  ) {
    const { host, port, password, db, prefix } = config.cache.redis;
    this.prefix = prefix;
    this.clientName = `core-${identity?.id ?? 'app'}`;
    this.options = {
      host,
      port,
      db,
      // CLIENT LIST → biết kết nối thuộc runtime nào (Cache Monitor).
      connectionName: this.clientName,
      ...(password ? { password } : {}),
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 500, MAX_RETRY_DELAY_MS),
    };
    this.client = this.createClient();
  }

  /** Số DB Redis đang dùng (SELECT). */
  public get db(): number {
    return this.options.db ?? 0;
  }

  /** Kiểm tra xem kết nối hoặc dịch vụ đã sẵn sàng tiếp nhận yêu cầu hay chưa */
  public isReady(): boolean {
    return this.client.status === 'ready';
  }

  /** Đợi kết nối sẵn sàng tối đa `timeoutMs`; trả về có sẵn sàng hay không. */
  public waitUntilReady(timeoutMs: number): Promise<boolean> {
    if (this.isReady()) return Promise.resolve(true);
    return new Promise((resolve) => {
      /** Đánh dấu hoàn tất tiến trình hoặc giải phóng tài nguyên */
      const done = (ready: boolean) => {
        clearTimeout(timer);
        this.client.off('ready', onReady);
        resolve(ready);
      };
      /** Xử lý sự kiện khi kết nối dịch vụ đã sẵn sàng hoạt động */
      const onReady = () => done(true);
      const timer = setTimeout(() => done(this.isReady()), timeoutMs);
      this.client.once('ready', onReady);
    });
  }

  /** Lấy thông tin lỗi phát sinh gần nhất của dịch vụ */
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
      connectionName: `${this.clientName}-bull`,
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

  /** Đăng ký observer nhận độ trễ từng lệnh Redis (trả về hàm hủy đăng ký). */
  public registerLatencyObserver(observer: RedisLatencyObserver): () => void {
    this.latencyObservers.add(observer);
    return () => {
      this.latencyObservers.delete(observer);
    };
  }

  /** Đo RTT lệnh PING tới Redis (ms); trả về `null` nếu chưa sẵn sàng hoặc lỗi. */
  public async measurePingMs(): Promise<number | null> {
    if (!this.isReady()) return null;
    const started = performance.now();
    try {
      await this.client.ping();
      const ms = Math.round((performance.now() - started) * 100) / 100;
      this.lastPingMs = ms;
      return ms;
    } catch {
      return null;
    }
  }

  /** Ảnh chụp phân vị độ trễ lệnh Redis (p50/p95/p99, avg, lastPingMs) từ ring buffer. */
  public getLatencySnapshot(): RedisLatencySnapshot {
    const count = this.latencySamples.length;
    if (count === 0) {
      return {
        count: 0,
        avgMs: null,
        p50Ms: null,
        p95Ms: null,
        p99Ms: null,
        lastPingMs: this.lastPingMs,
      };
    }
    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    return {
      count,
      avgMs: Math.round((sum / count) * 100) / 100,
      p50Ms: quantile(sorted, 0.5),
      p95Ms: quantile(sorted, 0.95),
      p99Ms: quantile(sorted, 0.99),
      lastPingMs: this.lastPingMs,
    };
  }

  /** Đóng ở pha cuối để các provider khác còn ghi được sự kiện lúc shutdown. */
  public async onApplicationShutdown(): Promise<void> {
    await Promise.allSettled([this.client, ...this.subscribers].map((c) => c.quit()));
  }

  /** Ghi nhận mẫu độ trễ vào ring buffer và thông báo cho các observer. */
  private recordCommandLatency(operation: string, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    this.latencySamples.push(durationMs);
    if (this.latencySamples.length > MAX_LATENCY_SAMPLES) {
      this.latencySamples.shift();
    }
    for (const observer of this.latencyObservers) {
      try {
        observer(operation, durationMs);
      } catch {
        // Bỏ qua lỗi từ observer đo lường để không ảnh hưởng luồng Redis chính.
      }
    }
  }

  /** Bọc `sendCommand` của ioredis (nếu có) để đo độ trễ lệnh mà vẫn tương thích mock client trong test. */
  private instrumentClient(client: Redis): void {
    const rawSend = (client as unknown as { sendCommand?: (cmd: unknown) => unknown }).sendCommand;
    if (typeof rawSend !== 'function') return;

    (client as unknown as { sendCommand: (cmd: unknown) => unknown }).sendCommand = (
      command: unknown,
    ) => {
      const cmdObj = command as { name?: unknown; promise?: Promise<unknown> } | null;
      const started = performance.now();
      const op = normalizeRedisCommand(cmdObj?.name);
      const result = rawSend.call(client, command);
      const promise = cmdObj?.promise;
      if (promise && typeof promise.finally === 'function') {
        void promise
          .finally(() => {
            this.recordCommandLatency(op, performance.now() - started);
          })
          .catch(() => undefined);
      }
      return result;
    };
  }

  /** Khởi tạo một client kết nối mới tới dịch vụ */
  private createClient(overrides: Partial<RedisOptions> = {}): Redis {
    const client = this.factory({ ...this.options, ...overrides });
    this.instrumentClient(client);
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

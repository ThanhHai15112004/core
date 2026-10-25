import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import type {
  CacheContract,
  CacheGetOrSetOptions,
  CacheLatencyStats,
} from '../contracts/cache.contract.js';
import type { CacheErrorRecord } from '../contracts/cache-events.types.js';
import { CACHE_ERROR_LOG_SIZE, cacheKeys } from '../constants/cache.keys.js';
import type { CacheDriver } from '../drivers/cache-driver.js';
import { MemoryCacheDriver } from '../drivers/memory-cache.driver.js';
import { RedisCacheDriver } from '../drivers/redis-cache.driver.js';
import { buildStandardCacheKey, namespaceOf, normalizeCacheSegment } from '../utils/namespace.js';
import { classifyCacheError, sanitizeCacheMessage } from '../utils/cache-errors.js';

/** Tối đa số lỗi ghi vào Redis mỗi giây (Redis sập → mọi lệnh lỗi, không ghi tràn). */
const ERROR_RECORDS_PER_SEC = 5;
/** TTL mặc định khi tạo cache qua `getOrSet` / `remember` mà cấu hình `defaultTtlSec = 0` (5 phút). */
export const DEFAULT_CACHE_GET_OR_SET_TTL_SEC = 300;
const MAX_LATENCY_SAMPLES = 200;

export interface CacheAdapterOptions {
  /** Tự động ưu tiên MemoryCacheDriver khi `NODE_ENV=test` (mặc định false để giữ tương thích test tích hợp). */
  preferMemoryInTest?: boolean;
}

/**
 * Cache của Core. Driver chọn theo `CACHE_DRIVER` (redis dùng chung giữa runtime / memory riêng từng process),
 * API không đổi. Hit/miss đọc từ `INFO` của Redis (không tự đếm); lỗi được ghi lại cho trang Cache và không bao
 * giờ ném ra caller: đọc lỗi = miss, ghi lỗi = bỏ qua.
 */
@Injectable()
export class BaseCacheProvider implements CacheContract {
  private readonly logger = new Logger('Cache');
  public readonly driver: CacheDriver;
  private readonly depth: number;
  private readonly defaultTtlSec: number;
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private errorWindow = { at: 0, n: 0 };
  private lastLoggedError: string | null = null;
  private totalCommands = 0;
  private errorCount = 0;
  private lastLatencyMs: number | null = null;
  private readonly latencySamples: number[] = [];

  constructor(
    private readonly configService: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
    @Optional() options?: CacheAdapterOptions,
  ) {
    const cfg = this.configService.cache;
    this.depth = cfg.namespaceDepth;
    this.defaultTtlSec = cfg.defaultTtlSec;
    const useMemoryForTest = Boolean(options?.preferMemoryInTest && this.configService.isTest);
    this.driver =
      !useMemoryForTest && cfg.driver === 'redis' && this.redis
        ? new RedisCacheDriver(this.redis)
        : new MemoryCacheDriver();
  }

  /**
   * 7.5.1 — Khởi tạo Cache Adapter tự động dùng `RedisCacheDriver` ở Production
   * và `MemoryCacheDriver` ở môi trường Test.
   */
  public static createForEnvironment(
    configService: CoreConfigService,
    redis?: RedisService,
    identity?: RuntimeIdentity,
  ): BaseCacheProvider {
    return new BaseCacheProvider(configService, redis, identity, {
      preferMemoryInTest: true,
    });
  }

  /** Xác định namespace tương ứng của khóa bộ nhớ đệm */
  public namespaceOf(key: string): string {
    return namespaceOf(key, this.depth);
  }

  /**
   * 7.5.2 — Chuẩn hóa tên Cache Key theo cấu trúc `<project>:<environment>:<module>:<key>`
   * dựa trên cấu hình `app.name` và `app.env` hiện hành.
   */
  public buildKey(
    moduleName: string,
    key: string,
    overrides?: { project?: string; environment?: string },
  ): string {
    return buildStandardCacheKey({
      project: overrides?.project ?? this.configService.app.name,
      environment: overrides?.environment ?? this.configService.app.env,
      module: moduleName,
      key,
    });
  }

  /** Ghi nhận thời gian phản hồi của một thao tác bộ nhớ đệm */
  private recordLatency(startedMs: number): void {
    const elapsed = Number((performance.now() - startedMs).toFixed(3));
    this.totalCommands++;
    this.lastLatencyMs = elapsed;
    this.latencySamples.push(elapsed);
    if (this.latencySamples.length > MAX_LATENCY_SAMPLES) {
      this.latencySamples.shift();
    }
  }

  /**
   * 7.5.8 — Lấy thống kê độ trễ và số lượng lỗi của các thao tác Cache / Redis phục vụ Monitoring.
   */
  public getLatencyStats(): CacheLatencyStats {
    if (this.latencySamples.length === 0) {
      return {
        totalCommands: this.totalCommands,
        errorCount: this.errorCount,
        lastLatencyMs: this.lastLatencyMs,
        avgLatencyMs: null,
        maxLatencyMs: null,
        p95LatencyMs: null,
      };
    }
    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    const sum = sorted.reduce((acc, v) => acc + v, 0);
    const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
    return {
      totalCommands: this.totalCommands,
      errorCount: this.errorCount,
      lastLatencyMs: this.lastLatencyMs,
      avgLatencyMs: Number((sum / sorted.length).toFixed(3)),
      maxLatencyMs: sorted[sorted.length - 1] ?? null,
      p95LatencyMs: sorted[p95Idx] ?? null,
    };
  }

  /** Đặt lại bộ đếm thống kê độ trễ và lỗi */
  public resetLatencyStats(): void {
    this.totalCommands = 0;
    this.errorCount = 0;
    this.lastLatencyMs = null;
    this.latencySamples.length = 0;
  }

  /** Ghi nhận lỗi vận hành và lưu vào `cachemon:errors` phục vụ giám sát */
  private fail(operation: CacheErrorRecord['operation'], key: string | null, err: unknown): void {
    this.errorCount++;
    const kind = classifyCacheError(err);
    const message = sanitizeCacheMessage(err);
    if (this.lastLoggedError !== message) this.logger.warn(`Cache ${operation} failed: ${message}`);
    this.lastLoggedError = message;

    const now = Date.now();
    if (now - this.errorWindow.at >= 1000) this.errorWindow = { at: now, n: 0 };
    if (++this.errorWindow.n > ERROR_RECORDS_PER_SEC || !this.redis?.isReady()) return;
    const record: CacheErrorRecord = {
      at: now,
      kind,
      operation,
      namespace: key === null ? '*' : this.namespaceOf(key),
      message,
      runtime: this.identity?.id ?? null,
      instance: null,
      correlationId: RequestContextService.currentCorrelationId() ?? null,
    };
    const listKey = cacheKeys(this.redis).errors();
    void this.redis.client
      .multi()
      .lpush(listKey, JSON.stringify(record))
      .ltrim(listKey, 0, CACHE_ERROR_LOG_SIZE - 1)
      .exec()
      .catch(() => undefined);
  }

  /** Lấy dữ liệu hoặc đối tượng theo khóa định danh */
  public async get<T>(key: string): Promise<T | null> {
    const started = performance.now();
    try {
      const result = await this.driver.get(key);
      this.recordLatency(started);
      return result.found ? (result.value as T) : null;
    } catch (err) {
      this.recordLatency(started);
      this.fail('get', key, err);
      return null;
    }
  }

  /** Lưu trữ một giá trị theo khóa định danh kèm thời gian hết hạn (TTL) */
  public async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const started = performance.now();
    try {
      await this.driver.set(key, value, ttlSeconds ?? this.defaultTtlSec);
      this.recordLatency(started);
    } catch (err) {
      this.recordLatency(started);
      this.fail('set', key, err);
    }
  }

  /** Xóa bản ghi khỏi hệ thống theo mã định danh */
  public async delete(key: string): Promise<void> {
    const started = performance.now();
    try {
      await this.driver.delete(key);
      this.recordLatency(started);
    } catch (err) {
      this.recordLatency(started);
      this.fail('delete', key, err);
    }
  }

  /**
   * 7.5.4 — Xóa hàng loạt các khóa cache có chung tiền tố `prefix` khi dữ liệu thay đổi.
   */
  public async deleteByPrefix(prefix: string): Promise<number> {
    const started = performance.now();
    try {
      const deleted = await this.driver.deleteByPrefix(prefix);
      this.recordLatency(started);
      return deleted;
    } catch (err) {
      this.recordLatency(started);
      this.fail('delete', prefix, err);
      return 0;
    }
  }

  /**
   * 7.5.4 — Xóa toàn bộ cache thuộc một `module` (bao gồm cả dạng `<module>:*` và `<project>:<env>:<module>:*`).
   */
  public async invalidateModule(moduleName: string): Promise<number> {
    const normModule = normalizeCacheSegment(moduleName, 'common');
    const scopedPrefix = `${normalizeCacheSegment(this.configService.app.name, 'core')}:${normalizeCacheSegment(this.configService.app.env, 'development')}:${normModule}:`;
    const directPrefix = `${normModule}:`;
    const [scopedDeleted, directDeleted] = await Promise.all([
      this.deleteByPrefix(scopedPrefix),
      this.deleteByPrefix(directPrefix),
    ]);
    return scopedDeleted + directDeleted;
  }

  /**
   * 7.5.5 — Lấy dữ liệu từ cache hoặc gọi `factory()` để tạo mới với cơ chế chống Cache Stampede:
   * 1. In-process Singleflight: Gộp các request đồng thời trong cùng một process vào chung 1 Promise.
   * 2. Cross-process Distributed Stampede Lock: Chỉ 1 process truy vấn DB tạo cache, các process khác chờ đọc kết quả.
   */
  public async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options?: number | CacheGetOrSetOptions,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const existingPromise = this.inFlight.get(key) as Promise<T> | undefined;
    if (existingPromise) {
      return existingPromise;
    }

    const opts: CacheGetOrSetOptions =
      typeof options === 'number' ? { ttlSeconds: options } : (options ?? {});
    const effectiveTtlSec =
      opts.ttlSeconds ??
      (this.defaultTtlSec > 0 ? this.defaultTtlSec : DEFAULT_CACHE_GET_OR_SET_TTL_SEC);

    const promise = this.resolveWithStampedeProtection(key, factory, {
      ...opts,
      ttlSeconds: effectiveTtlSec,
    });

    this.inFlight.set(key, promise);
    try {
      return await promise;
    } finally {
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
    }
  }

  /** Bí danh (alias) của `getOrSet` tương tự Laravel `Cache::remember`. */
  public async remember<T>(
    key: string,
    factory: () => Promise<T>,
    options?: number | CacheGetOrSetOptions,
  ): Promise<T> {
    return this.getOrSet(key, factory, options);
  }

  private async resolveWithStampedeProtection<T>(
    key: string,
    factory: () => Promise<T>,
    opts: Required<Pick<CacheGetOrSetOptions, 'ttlSeconds'>> & CacheGetOrSetOptions,
  ): Promise<T> {
    const useRedisLock =
      opts.stampedeLock !== false && this.driver.name === 'redis' && Boolean(this.redis?.isReady());

    if (!useRedisLock || !this.redis) {
      const freshValue = await factory();
      await this.set(key, freshValue, opts.ttlSeconds);
      return freshValue;
    }

    const lockKey = cacheKeys(this.redis).stampedeLock(key);
    const token = `${process.pid}:${Date.now()}:${randomUUID()}`;
    const lockTtlMs = Math.max(100, opts.lockTtlMs ?? 5000);
    const waitTimeoutMs = Math.max(50, opts.waitTimeoutMs ?? 2000);
    const pollIntervalMs = Math.max(10, opts.pollIntervalMs ?? 25);

    const acquired = await this.redis.client
      .set(lockKey, token, 'PX', lockTtlMs, 'NX')
      .then((res) => res === 'OK')
      .catch(() => true);

    if (acquired) {
      try {
        const doubleCheck = await this.get<T>(key);
        if (doubleCheck !== null) {
          return doubleCheck;
        }
        const freshValue = await factory();
        await this.set(key, freshValue, opts.ttlSeconds);
        return freshValue;
      } finally {
        const currentHolder = await this.redis.client.get(lockKey).catch(() => null);
        if (currentHolder === token) {
          await this.redis.client.del(lockKey).catch(() => undefined);
        }
      }
    }

    // Tiến trình khác đang giữ stampede lock để tạo cache → chờ ngắn hạn và đọc lại cache
    const deadline = Date.now() + waitTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      const populated = await this.get<T>(key);
      if (populated !== null) {
        return populated;
      }
      const stillLocked = await this.redis.client.exists(lockKey).catch(() => 0);
      if (!stillLocked) {
        const afterUnlock = await this.get<T>(key);
        if (afterUnlock !== null) {
          return afterUnlock;
        }
        break;
      }
    }

    const fallbackValue = await factory();
    await this.set(key, fallbackValue, opts.ttlSeconds);
    return fallbackValue;
  }

  /** Kiểm tra sự tồn tại của một khóa trong bộ lưu trữ */
  public async has(key: string): Promise<boolean> {
    const started = performance.now();
    try {
      const exists = await this.driver.has(key);
      this.recordLatency(started);
      return exists;
    } catch (err) {
      this.recordLatency(started);
      this.fail('has', key, err);
      return false;
    }
  }

  /** Xóa sạch toàn bộ dữ liệu trong bộ lưu trữ */
  public async clear(): Promise<void> {
    await this.flush();
  }

  /** Xoá toàn bộ cache của core (không đụng dữ liệu khác trong Redis), trả số key đã xoá. Lỗi được ném ra. */
  public async flush(): Promise<number> {
    const started = performance.now();
    try {
      const deleted = await this.driver.clear();
      this.recordLatency(started);
      return deleted;
    } catch (err) {
      this.recordLatency(started);
      this.fail('clear', null, err);
      throw err;
    }
  }
}

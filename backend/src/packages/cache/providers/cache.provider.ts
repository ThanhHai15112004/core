import { performance } from 'node:perf_hooks';
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import { MetricRecorder, addRequestTiming } from '@packages/telemetry/index.js';
import type { CacheContract } from '../contracts/cache.contract.js';
import type { CacheErrorRecord } from '../contracts/cache-events.types.js';
import { CACHE_ERROR_LOG_SIZE, cacheKeys } from '../constants/cache.keys.js';
import type { CacheDriver } from '../drivers/cache-driver.js';
import { MemoryCacheDriver } from '../drivers/memory-cache.driver.js';
import { RedisCacheDriver } from '../drivers/redis-cache.driver.js';
import { OTHER_NAMESPACE, namespaceOf } from '../utils/namespace.js';
import { classifyCacheError, sanitizeCacheMessage } from '../utils/cache-errors.js';

export interface CacheStats {
  keys: number | null;
  hits: number;
  misses: number;
  /** `null` khi chưa có lượt đọc nào. */
  hitRatePercent: number | null;
}

type OpKind = 'hit' | 'miss' | 'set' | 'del';

/** Số namespace tối đa có bộ đếm riêng (phần dư gộp vào `(other)`) — tránh bùng số field telemetry. */
export const MAX_TRACKED_NAMESPACES = 200;
/** Tối đa số lỗi ghi vào Redis mỗi giây (Redis sập → mọi lệnh lỗi, không ghi tràn). */
const ERROR_RECORDS_PER_SEC = 5;

/** Tên metric theo namespace, vd. `cache.ns.data:users.hit`. */
export const namespaceMetric = (ns: string, kind: OpKind | 'keys' | 'bytes') =>
  `cache.ns.${ns.replace(/\|/g, '_')}.${kind}`;

/**
 * Cache của Core. Driver chọn theo `CACHE_DRIVER` (redis dùng chung giữa runtime / memory riêng từng process),
 * API không đổi. Mọi thao tác được đo (hit/miss/set/del theo namespace, latency, lỗi) và lỗi của backend
 * cache không bao giờ ném ra caller: đọc lỗi = miss, ghi lỗi = bỏ qua.
 */
@Injectable()
export class BaseCacheProvider implements CacheContract {
  private readonly logger = new Logger('Cache');
  public readonly driver: CacheDriver;
  private readonly depth: number;
  private readonly defaultTtlSec: number;
  private readonly namespaces = new Set<string>();
  private hits = 0;
  private misses = 0;
  private errorWindow = { at: 0, n: 0 };
  private lastLoggedError: string | null = null;

  constructor(
    private readonly configService: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly recorder?: MetricRecorder,
    @Optional() @Inject(RUNTIME_IDENTITY) private readonly identity?: RuntimeIdentity,
  ) {
    const cfg = this.configService.cache;
    this.depth = cfg.namespaceDepth;
    this.defaultTtlSec = cfg.defaultTtlSec;
    this.driver =
      cfg.driver === 'redis' && this.redis
        ? new RedisCacheDriver(this.redis)
        : new MemoryCacheDriver();
  }

  public namespaceOf(key: string): string {
    return namespaceOf(key, this.depth);
  }

  private trackedNamespace(key: string): string {
    const ns = this.namespaceOf(key);
    if (this.namespaces.has(ns)) return ns;
    if (this.namespaces.size >= MAX_TRACKED_NAMESPACES) return OTHER_NAMESPACE;
    this.namespaces.add(ns);
    return ns;
  }

  /** Ghi số đo một thao tác: tổng theo loại, theo namespace, thời gian, và cộng vào request hiện tại. */
  private track(kind: OpKind, key: string, startedAt: number): void {
    const ms = performance.now() - startedAt;
    this.recorder?.count(`cache.${kind}`);
    this.recorder?.count(namespaceMetric(this.trackedNamespace(key), kind));
    this.recorder?.timing('cache.op', ms);
    addRequestTiming('cache', ms);
  }

  private fail(operation: CacheErrorRecord['operation'], key: string | null, err: unknown): void {
    const kind = classifyCacheError(err);
    const message = sanitizeCacheMessage(err);
    this.recorder?.count('cache.errors');
    this.recorder?.count(`cache.err.${kind}`);
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
      instance: this.recorder?.instance ?? null,
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

  public async get<T>(key: string): Promise<T | null> {
    const startedAt = performance.now();
    try {
      const result = await this.driver.get(key);
      if (result.found) this.hits++;
      else this.misses++;
      this.track(result.found ? 'hit' : 'miss', key, startedAt);
      return result.found ? (result.value as T) : null;
    } catch (err) {
      this.misses++;
      this.track('miss', key, startedAt);
      this.fail('get', key, err);
      return null;
    }
  }

  public async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const startedAt = performance.now();
    try {
      await this.driver.set(key, value, ttlSeconds ?? this.defaultTtlSec);
      this.track('set', key, startedAt);
    } catch (err) {
      this.fail('set', key, err);
    }
  }

  public async delete(key: string): Promise<void> {
    const startedAt = performance.now();
    try {
      await this.driver.delete(key);
      this.track('del', key, startedAt);
    } catch (err) {
      this.fail('delete', key, err);
    }
  }

  public async has(key: string): Promise<boolean> {
    try {
      return await this.driver.has(key);
    } catch (err) {
      this.fail('has', key, err);
      return false;
    }
  }

  public async clear(): Promise<void> {
    await this.flush();
  }

  /** Xoá toàn bộ cache của core (không đụng dữ liệu khác trong Redis), trả số key đã xoá. Lỗi được ném ra. */
  public flush(): Promise<number> {
    return this.driver.clear();
  }

  /** Thống kê đọc của process hiện tại từ lúc khởi động; `keys` chỉ biết với driver memory. */
  public getStats(): CacheStats {
    const reads = this.hits + this.misses;
    return {
      keys: this.driver instanceof MemoryCacheDriver ? this.driver.entries().length : null,
      hits: this.hits,
      misses: this.misses,
      hitRatePercent: reads === 0 ? null : Number(((this.hits / reads) * 100).toFixed(1)),
    };
  }
}

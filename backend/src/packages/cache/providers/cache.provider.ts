import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { RedisService } from '@packages/redis/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { RUNTIME_IDENTITY, type RuntimeIdentity } from '@packages/runtime/index.js';
import type { CacheContract } from '../contracts/cache.contract.js';
import type { CacheErrorRecord } from '../contracts/cache-events.types.js';
import { CACHE_ERROR_LOG_SIZE, cacheKeys } from '../constants/cache.keys.js';
import type { CacheDriver } from '../drivers/cache-driver.js';
import { MemoryCacheDriver } from '../drivers/memory-cache.driver.js';
import { RedisCacheDriver } from '../drivers/redis-cache.driver.js';
import { namespaceOf } from '../utils/namespace.js';
import { classifyCacheError, sanitizeCacheMessage } from '../utils/cache-errors.js';

/** Tối đa số lỗi ghi vào Redis mỗi giây (Redis sập → mọi lệnh lỗi, không ghi tràn). */
const ERROR_RECORDS_PER_SEC = 5;

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
  private errorWindow = { at: 0, n: 0 };
  private lastLoggedError: string | null = null;

  constructor(
    private readonly configService: CoreConfigService,
    @Optional() private readonly redis?: RedisService,
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

  private fail(operation: CacheErrorRecord['operation'], key: string | null, err: unknown): void {
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

  public async get<T>(key: string): Promise<T | null> {
    try {
      const result = await this.driver.get(key);
      return result.found ? (result.value as T) : null;
    } catch (err) {
      this.fail('get', key, err);
      return null;
    }
  }

  public async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      await this.driver.set(key, value, ttlSeconds ?? this.defaultTtlSec);
    } catch (err) {
      this.fail('set', key, err);
    }
  }

  public async delete(key: string): Promise<void> {
    try {
      await this.driver.delete(key);
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
}

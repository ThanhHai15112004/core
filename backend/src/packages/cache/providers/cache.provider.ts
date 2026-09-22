import { performance } from 'node:perf_hooks';
import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { MetricRecorder, addRequestTiming } from '@packages/telemetry/index.js';
import type { CacheContract } from '../contracts/cache.contract.js';

export interface CacheStats {
  keys: number;
  hits: number;
  misses: number;
  /** `null` khi chưa có lượt đọc nào. */
  hitRatePercent: number | null;
}

interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
}

@Injectable()
export class BaseCacheProvider implements CacheContract {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly prefix: string;
  private hits = 0;
  private misses = 0;

  constructor(
    private readonly configService: CoreConfigService,
    @Optional() private readonly recorder?: MetricRecorder,
  ) {
    this.prefix = this.configService.cache.redis.prefix;
  }

  /** Ghi số đo một thao tác cache: số lần theo loại, thời gian, và cộng vào request hiện tại. */
  private track(kind: 'hit' | 'miss' | 'set' | 'del', startedAt: number): void {
    const ms = performance.now() - startedAt;
    this.recorder?.count(`cache.${kind}`);
    this.recorder?.timing('cache.op', ms);
    addRequestTiming('cache', ms);
  }

  private getFullKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  public async get<T>(key: string): Promise<T | null> {
    const startedAt = performance.now();
    const fullKey = this.getFullKey(key);
    const entry = this.store.get(fullKey);
    if (!entry) {
      this.misses++;
      this.track('miss', startedAt);
      return null;
    }
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(fullKey);
      this.misses++;
      this.track('miss', startedAt);
      return null;
    }
    this.hits++;
    this.track('hit', startedAt);
    return entry.value as T;
  }

  public async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const startedAt = performance.now();
    const fullKey = this.getFullKey(key);
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.store.set(fullKey, { value, ...(expiresAt ? { expiresAt } : {}) });
    this.track('set', startedAt);
  }

  public async delete(key: string): Promise<void> {
    const startedAt = performance.now();
    this.store.delete(this.getFullKey(key));
    this.track('del', startedAt);
  }

  public async has(key: string): Promise<boolean> {
    const val = await this.get(key);
    return val !== null;
  }

  public async clear(): Promise<void> {
    this.store.clear();
  }

  /** Thống kê từ lúc process khởi động (hoặc lần `clear()` gần nhất với số key). */
  public getStats(): CacheStats {
    const reads = this.hits + this.misses;
    return {
      keys: this.store.size,
      hits: this.hits,
      misses: this.misses,
      hitRatePercent: reads === 0 ? null : Number(((this.hits / reads) * 100).toFixed(1)),
    };
  }
}

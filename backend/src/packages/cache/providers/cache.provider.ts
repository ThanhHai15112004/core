import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
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

  constructor(private readonly configService: CoreConfigService) {
    this.prefix = this.configService.cache.redis.prefix;
  }

  private getFullKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  public async get<T>(key: string): Promise<T | null> {
    const fullKey = this.getFullKey(key);
    const entry = this.store.get(fullKey);
    if (!entry) {
      this.misses++;
      return null;
    }
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(fullKey);
      this.misses++;
      return null;
    }
    this.hits++;
    return entry.value as T;
  }

  public async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const fullKey = this.getFullKey(key);
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.store.set(fullKey, { value, ...(expiresAt ? { expiresAt } : {}) });
  }

  public async delete(key: string): Promise<void> {
    this.store.delete(this.getFullKey(key));
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

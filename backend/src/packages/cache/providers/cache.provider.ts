import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import type { CacheContract } from '../contracts/cache.contract.js';

interface CacheEntry<T> {
  value: T;
  expiresAt?: number;
}

@Injectable()
export class BaseCacheProvider implements CacheContract {
  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly prefix: string;

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
      return null;
    }
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(fullKey);
      return null;
    }
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
}

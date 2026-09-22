import { Injectable } from '@nestjs/common';
import { RedisService } from '@packages/redis/index.js';
import {
  cacheKeys,
  type CacheErrorRecord,
  type CacheEventRecord,
  type CacheOperationRecord,
} from '@packages/cache/index.js';
import type { StoredCacheAlert } from './cache-rules.js';

/** Số liệu server lần đọc trước (để tính delta evicted/expired/rejected). */
export interface ServerCounters {
  at: number;
  evicted: number | null;
  expired: number | null;
  rejected: number | null;
  uptimeSec: number | null;
}

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const parseList = <T>(raws: string[]) =>
  raws.map((r) => parseJson<T>(r)).filter((x): x is T => x !== null);

/** Dữ liệu Cache Monitor trong Redis (sự kiện, lỗi, audit, cảnh báo) — nằm ngoài vùng dữ liệu cache. */
@Injectable()
export class CacheStoreService {
  public readonly keys: ReturnType<typeof cacheKeys>;

  constructor(private readonly redis: RedisService) {
    this.keys = cacheKeys(redis);
  }

  public get client() {
    return this.redis.client;
  }

  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  public async events(): Promise<CacheEventRecord[]> {
    return parseList<CacheEventRecord>(await this.redis.client.lrange(this.keys.events(), 0, -1));
  }

  public async errors(): Promise<CacheErrorRecord[]> {
    return parseList<CacheErrorRecord>(await this.redis.client.lrange(this.keys.errors(), 0, -1));
  }

  public async operations(): Promise<CacheOperationRecord[]> {
    return parseList<CacheOperationRecord>(
      await this.redis.client.lrange(this.keys.operations(), 0, -1),
    );
  }

  public async activeAlerts(): Promise<Map<string, StoredCacheAlert>> {
    const hash = await this.redis.client.hgetall(this.keys.activeAlerts());
    const map = new Map<string, StoredCacheAlert>();
    for (const [id, raw] of Object.entries(hash)) {
      const state = parseJson<StoredCacheAlert>(raw);
      if (state) map.set(id, state);
    }
    return map;
  }

  public async serverCounters(): Promise<ServerCounters | null> {
    return parseJson<ServerCounters>(await this.redis.client.get(this.keys.serverPrev()));
  }

  public async setServerCounters(c: ServerCounters): Promise<void> {
    await this.redis.client.set(this.keys.serverPrev(), JSON.stringify(c), 'EX', 3600);
  }
}

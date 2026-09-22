import { Injectable } from '@nestjs/common';
import { RedisService } from '@packages/redis/index.js';
import {
  storageKeys,
  type StorageErrorRecord,
  type StorageEventRecord,
  type StorageOperationRecord,
} from '@packages/storage/index.js';
import type { StoredStorageAlert } from './storage-rules.js';

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

/** Dữ liệu Storage Monitor trong Redis (sự kiện, lỗi, audit, cảnh báo). */
@Injectable()
export class StorageStoreService {
  public readonly keys: ReturnType<typeof storageKeys>;

  constructor(private readonly redis: RedisService) {
    this.keys = storageKeys(redis);
  }

  public get client() {
    return this.redis.client;
  }

  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  public async events(): Promise<StorageEventRecord[]> {
    return parseList<StorageEventRecord>(await this.redis.client.lrange(this.keys.events(), 0, -1));
  }

  public async errors(): Promise<StorageErrorRecord[]> {
    return parseList<StorageErrorRecord>(await this.redis.client.lrange(this.keys.errors(), 0, -1));
  }

  public async operations(): Promise<StorageOperationRecord[]> {
    return parseList<StorageOperationRecord>(
      await this.redis.client.lrange(this.keys.operations(), 0, -1),
    );
  }

  public async activeAlerts(): Promise<Map<string, StoredStorageAlert>> {
    const hash = await this.redis.client.hgetall(this.keys.activeAlerts());
    const map = new Map<string, StoredStorageAlert>();
    for (const [id, raw] of Object.entries(hash)) {
      const state = parseJson<StoredStorageAlert>(raw);
      if (state) map.set(id, state);
    }
    return map;
  }
}

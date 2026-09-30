import { Injectable } from '@nestjs/common';
import { RedisService } from '@packages/redis/index.js';
import {
  queueKeys,
  type QueueEventRecord,
  type QueueOperationRecord,
} from '@packages/queue/index.js';
import type { StoredWorkerAlert } from './worker-rules.js';

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

/** Dữ liệu Worker & Queue Monitor trong Redis (sự kiện, audit, cảnh báo đang diễn ra). */
@Injectable()
export class WorkerStoreService {
  public readonly keys: ReturnType<typeof queueKeys>;

  constructor(private readonly redis: RedisService) {
    this.keys = queueKeys(redis);
  }

  public get client() {
    return this.redis.client;
  }

  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  public async events(): Promise<QueueEventRecord[]> {
    return parseList<QueueEventRecord>(await this.redis.client.lrange(this.keys.events(), 0, -1));
  }

  public async operations(): Promise<QueueOperationRecord[]> {
    return parseList<QueueOperationRecord>(
      await this.redis.client.lrange(this.keys.operations(), 0, -1),
    );
  }

  public async activeAlerts(): Promise<Map<string, StoredWorkerAlert>> {
    const hash = await this.redis.client.hgetall(this.keys.activeAlerts());
    const map = new Map<string, StoredWorkerAlert>();
    for (const [id, raw] of Object.entries(hash)) {
      const state = parseJson<StoredWorkerAlert>(raw);
      if (state) map.set(id, state);
    }
    return map;
  }
}

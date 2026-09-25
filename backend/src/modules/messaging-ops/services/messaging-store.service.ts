import { Injectable } from '@nestjs/common';
import { RedisService } from '@packages/redis/index.js';
import {
  messagingKeys,
  type MessagingErrorRecord,
  type MessagingEventRecord,
  type MessagingOperationRecord,
} from '@packages/messaging/index.js';
import type { StoredMessagingAlert } from './messaging-rules.js';

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

/** Dữ liệu Messaging Monitor trong Redis (sự kiện, lỗi, audit, cảnh báo). */
@Injectable()
export class MessagingStoreService {
  public readonly keys: ReturnType<typeof messagingKeys>;

  constructor(private readonly redis: RedisService) {
    this.keys = messagingKeys(redis);
  }

  public get client() {
    return this.redis.client;
  }

  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  public async events(): Promise<MessagingEventRecord[]> {
    return parseList<MessagingEventRecord>(
      await this.redis.client.lrange(this.keys.events(), 0, -1),
    );
  }

  public async errors(): Promise<MessagingErrorRecord[]> {
    return parseList<MessagingErrorRecord>(
      await this.redis.client.lrange(this.keys.errors(), 0, -1),
    );
  }

  public async operations(): Promise<MessagingOperationRecord[]> {
    return parseList<MessagingOperationRecord>(
      await this.redis.client.lrange(this.keys.operations(), 0, -1),
    );
  }

  public async activeAlerts(): Promise<Map<string, StoredMessagingAlert>> {
    const hash = await this.redis.client.hgetall(this.keys.activeAlerts());
    const map = new Map<string, StoredMessagingAlert>();
    for (const [id, raw] of Object.entries(hash)) {
      const state = parseJson<StoredMessagingAlert>(raw);
      if (state) map.set(id, state);
    }
    return map;
  }
}

import { Injectable } from '@nestjs/common';
import { safeJsonParse, safeJsonParseList } from '@packages/kernel/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  messagingKeys,
  type MessagingEventRecord,
  type MessagingOperationRecord,
} from '@packages/messaging/index.js';
import type { StoredMessagingAlert } from './messaging-rules.js';

/** Dữ liệu Messaging Monitor trong Redis (sự kiện, audit, cảnh báo). */
@Injectable()
export class MessagingStoreService {
  public readonly keys: ReturnType<typeof messagingKeys>;

  constructor(private readonly redis: RedisService) {
    this.keys = messagingKeys(redis);
  }

  public get client() {
    return this.redis.client;
  }

  /** Kiểm tra dịch vụ hoặc kết nối có đang sẵn sàng hoạt động hay không */
  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  /** Truy vấn danh sách các sự kiện vận hành gần đây */
  public async events(): Promise<MessagingEventRecord[]> {
    return safeJsonParseList<MessagingEventRecord>(
      await this.redis.client.lrange(this.keys.events(), 0, -1),
    );
  }

  /** Truy vấn lịch sử các thao tác vận hành đã thực hiện */
  public async operations(): Promise<MessagingOperationRecord[]> {
    return safeJsonParseList<MessagingOperationRecord>(
      await this.redis.client.lrange(this.keys.operations(), 0, -1),
    );
  }

  /** Lấy danh sách các cảnh báo hệ thống đang hoạt động */
  public async activeAlerts(): Promise<Map<string, StoredMessagingAlert>> {
    const hash = await this.redis.client.hgetall(this.keys.activeAlerts());
    const map = new Map<string, StoredMessagingAlert>();
    for (const [id, raw] of Object.entries(hash)) {
      const state = safeJsonParse<StoredMessagingAlert>(raw);
      if (state) map.set(id, state);
    }
    return map;
  }
}

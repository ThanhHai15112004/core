import { Injectable } from '@nestjs/common';
import { safeJsonParse, safeJsonParseList } from '@packages/kernel/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  queueKeys,
  type QueueEventRecord,
  type QueueOperationRecord,
} from '@packages/queue/index.js';
import type { StoredWorkerAlert } from './worker-rules.js';

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

  /** Kiểm tra dịch vụ hoặc kết nối có đang sẵn sàng hoạt động hay không */
  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  /** Truy vấn danh sách các sự kiện vận hành gần đây */
  public async events(): Promise<QueueEventRecord[]> {
    return safeJsonParseList<QueueEventRecord>(
      await this.redis.client.lrange(this.keys.events(), 0, -1),
    );
  }

  /** Truy vấn lịch sử các thao tác vận hành đã thực hiện */
  public async operations(): Promise<QueueOperationRecord[]> {
    return safeJsonParseList<QueueOperationRecord>(
      await this.redis.client.lrange(this.keys.operations(), 0, -1),
    );
  }

  /** Lấy danh sách các cảnh báo hệ thống đang hoạt động */
  public async activeAlerts(): Promise<Map<string, StoredWorkerAlert>> {
    const hash = await this.redis.client.hgetall(this.keys.activeAlerts());
    const map = new Map<string, StoredWorkerAlert>();
    for (const [id, raw] of Object.entries(hash)) {
      const state = safeJsonParse<StoredWorkerAlert>(raw);
      if (state) map.set(id, state);
    }
    return map;
  }
}

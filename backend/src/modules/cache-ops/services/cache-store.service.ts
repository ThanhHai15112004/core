import { Injectable } from '@nestjs/common';
import { safeJsonParse, safeJsonParseList } from '@packages/kernel/index.js';
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
  hits: number | null;
  misses: number | null;
  uptimeSec: number | null;
}

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

  /** Kiểm tra dịch vụ hoặc kết nối có đang sẵn sàng hoạt động hay không */
  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  /** Truy vấn danh sách các sự kiện vận hành gần đây */
  public async events(): Promise<CacheEventRecord[]> {
    return safeJsonParseList<CacheEventRecord>(
      await this.redis.client.lrange(this.keys.events(), 0, -1),
    );
  }

  /** Truy vấn danh sách các lỗi và ngoại lệ ghi nhận được */
  public async errors(): Promise<CacheErrorRecord[]> {
    return safeJsonParseList<CacheErrorRecord>(
      await this.redis.client.lrange(this.keys.errors(), 0, -1),
    );
  }

  /** Truy vấn lịch sử các thao tác vận hành đã thực hiện */
  public async operations(): Promise<CacheOperationRecord[]> {
    return safeJsonParseList<CacheOperationRecord>(
      await this.redis.client.lrange(this.keys.operations(), 0, -1),
    );
  }

  /** Lấy danh sách các cảnh báo hệ thống đang hoạt động */
  public async activeAlerts(): Promise<Map<string, StoredCacheAlert>> {
    const hash = await this.redis.client.hgetall(this.keys.activeAlerts());
    const map = new Map<string, StoredCacheAlert>();
    for (const [id, raw] of Object.entries(hash)) {
      const state = safeJsonParse<StoredCacheAlert>(raw);
      if (state) map.set(id, state);
    }
    return map;
  }

  /** Lấy các bộ đếm thống kê vận hành máy chủ */
  public async serverCounters(): Promise<ServerCounters | null> {
    return safeJsonParse<ServerCounters>(await this.redis.client.get(this.keys.serverPrev()));
  }

  /** Cập nhật các bộ đếm thống kê vận hành máy chủ */
  public async setServerCounters(c: ServerCounters): Promise<void> {
    await this.redis.client.set(this.keys.serverPrev(), JSON.stringify(c), 'EX', 3600);
  }
}

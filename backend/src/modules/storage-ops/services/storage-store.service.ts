import { Injectable } from '@nestjs/common';
import { RedisService } from '@packages/redis/index.js';
import {
  storageKeys,
  type StorageErrorRecord,
  type StorageEventRecord,
  type StorageOperationRecord,
} from '@packages/storage/index.js';
import type { StoredStorageAlert } from './storage-rules.js';

/** Phân tích cú pháp chuỗi JSON an toàn với giá trị dự phòng */
function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Phân tích cú pháp chuỗi phân tách thành mảng danh sách */
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

  /** Kiểm tra dịch vụ hoặc kết nối có đang sẵn sàng hoạt động hay không */
  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  /** Truy vấn danh sách các sự kiện vận hành gần đây */
  public async events(): Promise<StorageEventRecord[]> {
    return parseList<StorageEventRecord>(await this.redis.client.lrange(this.keys.events(), 0, -1));
  }

  /** Truy vấn danh sách các lỗi và ngoại lệ ghi nhận được */
  public async errors(): Promise<StorageErrorRecord[]> {
    return parseList<StorageErrorRecord>(await this.redis.client.lrange(this.keys.errors(), 0, -1));
  }

  /** Truy vấn lịch sử các thao tác vận hành đã thực hiện */
  public async operations(): Promise<StorageOperationRecord[]> {
    return parseList<StorageOperationRecord>(
      await this.redis.client.lrange(this.keys.operations(), 0, -1),
    );
  }

  /** Lấy danh sách các cảnh báo hệ thống đang hoạt động */
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

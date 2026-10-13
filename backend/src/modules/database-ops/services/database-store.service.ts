import { Injectable } from '@nestjs/common';
import { RedisService } from '@packages/redis/index.js';
import {
  databaseKeys,
  type ConnectionStatus,
  type DbErrorRecord,
  type DbEventRecord,
} from '@packages/database/index.js';
import type { StoredAlert } from './database-rules.js';

export interface StorageSnapshot {
  /** epoch ms */
  at: number;
  totalBytes: number;
  tables: { name: string; bytes: number; rows: number | null }[];
}

export interface TableIoRate {
  readsPerSec: number;
  writesPerSec: number;
  at: number;
}

export type ActiveAlertState = StoredAlert;

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

/** Dữ liệu Database Monitor trong Redis (sự kiện, lỗi, snapshot dung lượng, cảnh báo, trạng thái kết nối). */
@Injectable()
export class DatabaseStoreService {
  public readonly keys: ReturnType<typeof databaseKeys>;

  constructor(private readonly redis: RedisService) {
    this.keys = databaseKeys(redis);
  }

  public get client() {
    return this.redis.client;
  }

  /** Kiểm tra dịch vụ hoặc kết nối có đang sẵn sàng hoạt động hay không */
  public isAvailable(): boolean {
    return this.redis.isReady();
  }

  /** Truy vấn danh sách các sự kiện vận hành gần đây */
  public async events(): Promise<DbEventRecord[]> {
    return parseList<DbEventRecord>(await this.redis.client.lrange(this.keys.events(), 0, -1));
  }

  /** Truy vấn danh sách các lỗi và ngoại lệ ghi nhận được */
  public async errors(): Promise<DbErrorRecord[]> {
    return parseList<DbErrorRecord>(await this.redis.client.lrange(this.keys.errors(), 0, -1));
  }

  /** Lấy các bản chụp lịch sử dung lượng lưu trữ */
  public async storageSnapshots(): Promise<StorageSnapshot[]> {
    return parseList<StorageSnapshot>(await this.redis.client.lrange(this.keys.storage(), 0, -1));
  }

  /** Lấy số liệu thống kê I/O đọc/ghi của các bảng */
  public async tableIo(): Promise<Map<string, TableIoRate>> {
    const hash = await this.redis.client.hgetall(this.redis.key('db', 'tableio'));
    const map = new Map<string, TableIoRate>();
    for (const [name, raw] of Object.entries(hash)) {
      const rate = parseJson<TableIoRate>(raw);
      if (rate) map.set(name, rate);
    }
    return map;
  }

  /** Tạo khóa định danh cho dữ liệu thống kê I/O của bảng */
  public tableIoKey(): string {
    return this.redis.key('db', 'tableio');
  }

  /** Lấy danh sách các cảnh báo hệ thống đang hoạt động */
  public async activeAlerts(): Promise<Map<string, ActiveAlertState>> {
    const hash = await this.redis.client.hgetall(this.keys.activeAlerts());
    const map = new Map<string, ActiveAlertState>();
    for (const [id, raw] of Object.entries(hash)) {
      const state = parseJson<ActiveAlertState>(raw);
      if (state) map.set(id, state);
    }
    return map;
  }

  /** Trạng thái kết nối của các instance (key TTL — instance đã tắt tự biến mất). */
  public async connections(instances: string[]): Promise<Map<string, ConnectionStatus>> {
    if (instances.length === 0) return new Map();
    const raws = await this.redis.client.mget(...instances.map((i) => this.keys.connection(i)));
    const map = new Map<string, ConnectionStatus>();
    raws.forEach((raw, i) => {
      const status = parseJson<ConnectionStatus>(raw);
      if (status) map.set(instances[i]!, status);
    });
    return map;
  }
}

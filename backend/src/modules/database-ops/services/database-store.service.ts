import { Injectable } from '@nestjs/common';
import { safeJsonParse, safeJsonParseList } from '@packages/kernel/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  BACKUP_HISTORY_SIZE,
  databaseKeys,
  type ConnectionStatus,
  type DbBackupReportRecord,
  type DbErrorRecord,
  type DbEventRecord,
  type DbSlowQueryRecord,
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

export interface DbReplicationStatusSnapshot {
  readonly configured: boolean;
  readonly available: boolean;
  readonly state: 'disabled' | 'streaming' | 'lagging' | 'stopped' | 'standalone' | 'unavailable';
  readonly lagMs: number | null;
  readonly pingMs: number | null;
  readonly ioRunning: boolean | null;
  readonly sqlRunning: boolean | null;
  readonly lastError: string | null;
  readonly checkedAt: string;
}

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
    return safeJsonParseList<DbEventRecord>(
      await this.redis.client.lrange(this.keys.events(), 0, -1),
    );
  }

  /** Truy vấn danh sách các lỗi và ngoại lệ ghi nhận được */
  public async errors(): Promise<DbErrorRecord[]> {
    return safeJsonParseList<DbErrorRecord>(
      await this.redis.client.lrange(this.keys.errors(), 0, -1),
    );
  }

  /** Truy vấn danh sách các câu query chậm đã ghi nhận kèm requestId/traceId */
  public async slowQueries(): Promise<DbSlowQueryRecord[]> {
    return safeJsonParseList<DbSlowQueryRecord>(
      await this.redis.client.lrange(this.keys.slowQueries(), 0, -1),
    );
  }

  /** Đọc báo cáo trạng thái backup gần nhất */
  public async getBackupStatus(): Promise<DbBackupReportRecord | null> {
    const raw = await this.redis.client.get(this.keys.backupStatus());
    return raw ? safeJsonParse<DbBackupReportRecord>(raw) : null;
  }

  /** Đọc lịch sử các lần backup gần đây */
  public async getBackupHistory(): Promise<DbBackupReportRecord[]> {
    return safeJsonParseList<DbBackupReportRecord>(
      await this.redis.client.lrange(this.keys.backupHistory(), 0, -1),
    );
  }

  /** Lưu trạng thái và lịch sử backup mới */
  public async saveBackupReport(record: DbBackupReportRecord): Promise<void> {
    const json = JSON.stringify(record);
    await this.redis.client
      .multi()
      .set(this.keys.backupStatus(), json)
      .lpush(this.keys.backupHistory(), json)
      .ltrim(this.keys.backupHistory(), 0, BACKUP_HISTORY_SIZE - 1)
      .exec();
  }

  /** Lấy các bản chụp lịch sử dung lượng lưu trữ */
  public async storageSnapshots(): Promise<StorageSnapshot[]> {
    return safeJsonParseList<StorageSnapshot>(
      await this.redis.client.lrange(this.keys.storage(), 0, -1),
    );
  }

  /** Lấy số liệu thống kê I/O đọc/ghi của các bảng */
  public async tableIo(): Promise<Map<string, TableIoRate>> {
    const hash = await this.redis.client.hgetall(this.redis.key('db', 'tableio'));
    const map = new Map<string, TableIoRate>();
    for (const [name, raw] of Object.entries(hash)) {
      const rate = safeJsonParse<TableIoRate>(raw);
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
      const state = safeJsonParse<ActiveAlertState>(raw);
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
      const status = safeJsonParse<ConnectionStatus>(raw);
      if (status) map.set(instances[i]!, status);
    });
    return map;
  }

  /** Đọc trạng thái đồng bộ Read Replica gần nhất từ Redis. */
  public async getReplicationStatus(): Promise<DbReplicationStatusSnapshot | null> {
    const raw = await this.redis.client.get(this.keys.replicationStatus());
    return raw ? safeJsonParse<DbReplicationStatusSnapshot>(raw) : null;
  }

  /** Lưu trạng thái đồng bộ Read Replica mới nhất lên Redis (TTL 5 phút). */
  public async saveReplicationStatus(snapshot: DbReplicationStatusSnapshot): Promise<void> {
    await this.redis.client
      .set(this.keys.replicationStatus(), JSON.stringify(snapshot), 'EX', 300)
      .catch(() => undefined);
  }
}

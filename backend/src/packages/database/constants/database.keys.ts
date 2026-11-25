import type { RedisService } from '@packages/redis/index.js';

/** Key Redis của Database Monitor (đã có REDIS_PREFIX). */
export const databaseKeys = (redis: RedisService) => ({
  /** LIST lỗi query gần đây (mới nhất trước). */
  errors: () => redis.key('db', 'errors'),
  /** LIST câu query chậm gần đây kèm requestId / traceId (mới nhất trước). */
  slowQueries: () => redis.key('db', 'slow_queries'),
  /** Trạng thái bản backup gần nhất (JSON). */
  backupStatus: () => redis.key('db', 'backup', 'status'),
  /** Lịch sử các lần backup gần đây (LIST JSON). */
  backupHistory: () => redis.key('db', 'backup', 'history'),
  /** LIST sự kiện database (mới nhất trước). */
  events: () => redis.key('db', 'events'),
  /** Hash ruleId → trạng thái cảnh báo đang diễn ra. */
  activeAlerts: () => redis.key('db', 'alerts'),
  /** LIST snapshot dung lượng (mới nhất trước). */
  storage: () => redis.key('db', 'storage'),
  /** Kết quả lần chạy migration gần nhất (JSON). */
  lastMigrationRun: () => redis.key('db', 'migrations', 'last'),
  /** Hash lưu checksum SHA-256 của các migration đã áp dụng (migrationName -> checksum). */
  migrationChecksums: () => redis.key('db', 'migrations', 'checksums'),
  /** Trạng thái kết nối của từng runtime (JSON, TTL). */
  connection: (instance: string) => redis.key('db', 'conn', instance),
  collectLock: () => redis.key('db', 'lock', 'collect'),
  migrateLock: () => redis.key('db', 'lock', 'migrate'),
  seedLock: () => redis.key('db', 'lock', 'seed'),
});

export const EVENT_LOG_SIZE = 1000;
/** Lỗi query gần nhất giữ lại (TypeORM logger ghi). */
export const ERROR_LOG_SIZE = 500;
/** Slow query gần nhất giữ lại (TypeORM logger ghi). */
export const SLOW_QUERY_LOG_SIZE = 500;
/** Số bản ghi lịch sử backup giữ lại. */
export const BACKUP_HISTORY_SIZE = 50;
/** Snapshot dung lượng mỗi giờ, giữ 90 ngày. */
export const STORAGE_SNAPSHOT_LIMIT = 90 * 24;

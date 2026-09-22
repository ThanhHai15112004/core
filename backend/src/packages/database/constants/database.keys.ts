import type { RedisService } from '@packages/redis/index.js';

/** Key Redis của Database Monitor (đã có REDIS_PREFIX). */
export const databaseKeys = (redis: RedisService) => ({
  /** LIST lỗi query gần đây (mới nhất trước). */
  errors: () => redis.key('db', 'errors'),
  /** LIST sự kiện database (mới nhất trước). */
  events: () => redis.key('db', 'events'),
  /** Hash ruleId → trạng thái cảnh báo đang diễn ra. */
  activeAlerts: () => redis.key('db', 'alerts'),
  /** LIST snapshot dung lượng (mới nhất trước). */
  storage: () => redis.key('db', 'storage'),
  /** Kết quả lần chạy migration gần nhất (JSON). */
  lastMigrationRun: () => redis.key('db', 'migrations', 'last'),
  /** Trạng thái kết nối của từng runtime (JSON, TTL). */
  connection: (instance: string) => redis.key('db', 'conn', instance),
  collectLock: () => redis.key('db', 'lock', 'collect'),
  migrateLock: () => redis.key('db', 'lock', 'migrate'),
});

export const ERROR_LOG_SIZE = 500;
export const EVENT_LOG_SIZE = 1000;
/** Snapshot dung lượng mỗi giờ, giữ 90 ngày. */
export const STORAGE_SNAPSHOT_LIMIT = 90 * 24;

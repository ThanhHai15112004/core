import type { RedisService } from '@packages/redis/index.js';

/**
 * Key Redis của cache (đã có REDIS_PREFIX).
 * Dữ liệu cache nằm dưới `<prefix>cache:*` — flush/clear chỉ được phép đụng vùng này.
 * Số liệu của Cache Monitor nằm riêng dưới `<prefix>cachemon:*` để flush cache không xoá lịch sử vận hành.
 */
export const cacheKeys = (redis: RedisService) => ({
  /** Prefix đầy đủ của dữ liệu cache, vd. `core:cache:`. */
  dataPrefix: () => `${redis.key('cache')}:`,
  data: (key: string) => `${redis.key('cache')}:${key}`,
  /** LIST lỗi cache gần đây (mới nhất trước). */
  errors: () => redis.key('cachemon', 'errors'),
  /** LIST sự kiện cache (mới nhất trước). */
  events: () => redis.key('cachemon', 'events'),
  /** LIST lịch sử thao tác quản trị (audit). */
  operations: () => redis.key('cachemon', 'ops'),
  /** Hash ruleId → cảnh báo đang diễn ra. */
  activeAlerts: () => redis.key('cachemon', 'alerts'),
  /** Snapshot keyspace gần nhất (JSON). */
  keyspace: () => redis.key('cachemon', 'keyspace'),
  /** Snapshot cache in-memory của từng runtime (JSON, TTL). */
  memorySnapshot: (instance: string) => redis.key('cachemon', 'mem', instance),
  memorySnapshotPattern: () => redis.key('cachemon', 'mem', '*'),
  /** Số liệu server đọc lần trước (để tính delta evicted/expired). */
  serverPrev: () => redis.key('cachemon', 'server', 'prev'),
  collectLock: () => redis.key('cachemon', 'lock', 'collect'),
  flushLock: () => redis.key('cachemon', 'lock', 'flush'),
});

export const CACHE_ERROR_LOG_SIZE = 500;
export const CACHE_EVENT_LOG_SIZE = 1000;
export const CACHE_OPERATION_LOG_SIZE = 500;

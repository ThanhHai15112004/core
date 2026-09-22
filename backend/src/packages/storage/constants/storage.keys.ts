import type { RedisService } from '@packages/redis/index.js';

/** Key Redis của Storage Monitor (đã có REDIS_PREFIX) — không chứa nội dung file. */
export const storageKeys = (redis: RedisService) => ({
  /** LIST lỗi thao tác storage gần đây (mới nhất trước). */
  errors: () => redis.key('storagemon', 'errors'),
  /** LIST sự kiện storage. */
  events: () => redis.key('storagemon', 'events'),
  /** LIST audit thao tác quản trị. */
  operations: () => redis.key('storagemon', 'ops'),
  /** Hash ruleId → cảnh báo đang diễn ra. */
  activeAlerts: () => redis.key('storagemon', 'alerts'),
  /** Snapshot usage gần nhất (JSON). */
  usage: () => redis.key('storagemon', 'usage'),
  /** LIST snapshot usage theo giờ (mới nhất trước). */
  snapshots: () => redis.key('storagemon', 'snapshots'),
  /** Upload đang chạy của từng runtime (JSON, TTL). */
  active: (instance: string) => redis.key('storagemon', 'active', instance),
  activePattern: () => redis.key('storagemon', 'active', '*'),
  collectLock: () => redis.key('storagemon', 'lock', 'collect'),
});

export const STORAGE_ERROR_LOG_SIZE = 500;
export const STORAGE_EVENT_LOG_SIZE = 1000;
export const STORAGE_OPERATION_LOG_SIZE = 500;
/** Snapshot usage mỗi giờ, giữ 90 ngày. */
export const STORAGE_SNAPSHOT_LIMIT = 90 * 24;
/** Tiền tố object tạm của Test Storage (bỏ qua khi quét usage). */
export const HEALTHCHECK_PREFIX = '.core-healthcheck/';

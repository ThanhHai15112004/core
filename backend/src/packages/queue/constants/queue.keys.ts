import type { RedisService } from '@packages/redis/index.js';

/** Key Redis của Worker & Queue Monitor (đã có REDIS_PREFIX) — không chứa dữ liệu job. */
export const queueKeys = (redis: RedisService) => ({
  /** LIST sự kiện queue (mới nhất trước). */
  events: () => redis.key('wqmon', 'events'),
  /** LIST audit thao tác queue. */
  operations: () => redis.key('wqmon', 'ops'),
  /** Hash alertId → cảnh báo đang diễn ra. */
  activeAlerts: () => redis.key('wqmon', 'alerts'),
  collectLock: () => redis.key('wqmon', 'lock', 'collect'),
});

export const QUEUE_EVENT_LOG_SIZE = 1000;
export const QUEUE_OPERATION_LOG_SIZE = 500;

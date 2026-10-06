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

/** Key Redis của Scheduler (định nghĩa task, task bị tắt, audit thao tác) — đã có REDIS_PREFIX. */
export const schedulerKeys = (redis: RedisService) => ({
  /** Hash taskId → định nghĩa (scheduler runtime ghi khi đồng bộ). */
  definitions: () => redis.key('scheduler', 'definitions'),
  /** SET taskId đang tắt — nguồn sự thật cho bật/tắt, đồng bộ sang BullMQ khi scheduler khởi động. */
  disabled: () => redis.key('scheduler', 'disabled'),
  /** LIST audit thao tác (Run Now / Enable / Disable). */
  operations: () => redis.key('scheduler', 'operations'),
});

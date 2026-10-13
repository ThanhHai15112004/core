import type { RedisService } from '@packages/redis/index.js';

/** Key Redis của Messaging Monitor (đã có REDIS_PREFIX) — không chứa payload. */
export const messagingKeys = (redis: RedisService) => ({
  /** LIST sự kiện messaging. */
  events: () => redis.key('msgmon', 'events'),
  /** LIST audit thao tác quản trị. */
  operations: () => redis.key('msgmon', 'ops'),
  /** Hash ruleId → cảnh báo đang diễn ra. */
  activeAlerts: () => redis.key('msgmon', 'alerts'),
  collectLock: () => redis.key('msgmon', 'lock', 'collect'),
});

export const MESSAGING_EVENT_LOG_SIZE = 1000;
export const MESSAGING_OPERATION_LOG_SIZE = 500;
/** Queue riêng của Test Broker — không bao giờ mang message nghiệp vụ (không đếm vào `messages_*_total`). */
export const HEALTHCHECK_QUEUE = 'core.healthcheck';

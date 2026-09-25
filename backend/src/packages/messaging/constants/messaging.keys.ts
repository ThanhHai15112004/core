import type { RedisService } from '@packages/redis/index.js';

/** Key Redis của Messaging Monitor (đã có REDIS_PREFIX) — không chứa payload. */
export const messagingKeys = (redis: RedisService) => ({
  /** LIST lỗi publish/consume gần đây (mới nhất trước). */
  errors: () => redis.key('msgmon', 'errors'),
  /** LIST sự kiện messaging. */
  events: () => redis.key('msgmon', 'events'),
  /** LIST audit thao tác quản trị. */
  operations: () => redis.key('msgmon', 'ops'),
  /** Hash ruleId → cảnh báo đang diễn ra. */
  activeAlerts: () => redis.key('msgmon', 'alerts'),
  /** Hash channel → { queue, producers, lastPublishedAt } (publisher cập nhật có throttle). */
  channels: () => redis.key('msgmon', 'channels'),
  /** Consumer đang chạy của từng runtime (JSON, TTL). */
  consumers: (instance: string) => redis.key('msgmon', 'consumers', instance),
  consumersPattern: () => redis.key('msgmon', 'consumers', '*'),
  collectLock: () => redis.key('msgmon', 'lock', 'collect'),
});

export const MESSAGING_ERROR_LOG_SIZE = 500;
export const MESSAGING_EVENT_LOG_SIZE = 1000;
export const MESSAGING_OPERATION_LOG_SIZE = 500;
/** Số channel tối đa có bộ đếm riêng (phần dư gộp vào `(other)`). */
export const MAX_TRACKED_CHANNELS = 100;
/** Queue riêng của Test Broker — không bao giờ mang message nghiệp vụ. */
export const HEALTHCHECK_QUEUE = 'core.healthcheck';

/** Metric theo channel, vd. `msg.ch.user.created.pub`. */
export const channelMetric = (channel: string, kind: string) =>
  `msg.ch.${channel.replace(/\|/g, '_')}.${kind}`;
/** Metric theo queue, vd. `msg.q.system.events.waiting`. */
export const queueMetric = (queue: string, kind: string) =>
  `msg.q.${queue.replace(/\|/g, '_')}.${kind}`;

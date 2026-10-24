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
  /** LIST audit thao tác từng job (retry / cancel / remove / payload). */
  jobOperations: () => redis.key('wqmon', 'jobops'),
  /** Tín hiệu huỷ hợp tác cho job đang chạy (TTL 24h). */
  cancelSignal: (queue: string, jobId: string) => redis.key('wqmon', 'cancel', queue, jobId),
  /** Snapshot tiến độ của job phục vụ theo dõi import/export/xử lý file (TTL 7 ngày). */
  progressSnapshot: (queue: string, jobId: string) => redis.key('wqmon', 'progress', queue, jobId),
  /** Danh sách lưu trữ bền vững các job thất bại cuối cùng (Dead-Letter Archive) để tra cứu nguyên nhân. */
  failedArchive: () => redis.key('wqmon', 'failed-archive'),
});

export const JOB_OPERATION_LOG_SIZE = 500;

export const QUEUE_EVENT_LOG_SIZE = 1000;
export const QUEUE_OPERATION_LOG_SIZE = 500;
export const FAILED_JOB_ARCHIVE_SIZE = 1000;
export const CANCEL_SIGNAL_TTL_SEC = 86_400;
export const PROGRESS_SNAPSHOT_TTL_SEC = 7 * 86_400;

/** Key Redis của Scheduler (định nghĩa task, task bị tắt, audit thao tác) — đã có REDIS_PREFIX. */
export const schedulerKeys = (redis: RedisService) => ({
  /** Hash taskId → định nghĩa (scheduler runtime ghi khi đồng bộ). */
  definitions: () => redis.key('scheduler', 'definitions'),
  /** SET taskId đang tắt — nguồn sự thật cho bật/tắt, đồng bộ sang BullMQ khi scheduler khởi động. */
  disabled: () => redis.key('scheduler', 'disabled'),
  /** LIST audit thao tác (Run Now / Enable / Disable). */
  operations: () => redis.key('scheduler', 'operations'),
});

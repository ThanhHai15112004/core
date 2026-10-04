export const QUEUES = {
  SYSTEM_EVENTS: 'system.events',
  NOTIFICATIONS: 'system.notifications',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Thời hạn khoá của job đang chạy (worker gia hạn định kỳ) — hết hạn mà không gia hạn = stalled. */
export const JOB_LOCK_DURATION_MS = 30_000;

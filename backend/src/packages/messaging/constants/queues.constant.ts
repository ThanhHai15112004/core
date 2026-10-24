export const QUEUES = {
  SYSTEM_EVENTS: 'system.events',
  SYSTEM_CRITICAL: 'system.critical',
  SYSTEM_NOTIFICATIONS: 'system.notifications',
  SYSTEM_HEAVY: 'system.heavy',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/**
 * Độ ưu tiên công việc chuẩn hóa theo quy ước BullMQ (số nhỏ = ưu tiên cao hơn):
 * - CRITICAL (1..2): xử lý tức thời (OTP, cảnh báo bảo mật)
 * - HIGH (3..10): ưu tiên cao (gửi thông báo đơn lẻ, tác vụ người dùng đang chờ)
 * - NORMAL (11..1000): công việc thông thường
 * - LOW (>1000): công việc nặng chạy nền (import/export hàng loạt, dọn dẹp file)
 */
export const JOB_PRIORITIES = {
  CRITICAL: 1,
  HIGH: 5,
  NORMAL: 50,
  LOW: 1500,
} as const;

export type JobPriorityValue = (typeof JOB_PRIORITIES)[keyof typeof JOB_PRIORITIES];

/** Thời hạn khoá mặc định của job đang chạy (worker gia hạn định kỳ) — hết hạn mà không gia hạn = stalled. */
export const JOB_LOCK_DURATION_MS = 30_000;

/** Giới hạn trần số lần thử tối đa cho một job để ngăn chặn retry vô hạn. */
export const MAX_JOB_ATTEMPTS_CAP = 10;

export interface QueueProfile {
  readonly name: QueueName;
  readonly description: string;
  readonly defaultPriority: number;
  readonly defaultAttempts: number;
  readonly defaultBackoff: 'exponential' | 'fixed';
  readonly defaultBackoffDelayMs: number;
  readonly defaultTimeoutMs: number;
  readonly defaultConcurrency: number;
  readonly lockDurationMs: number;
}

/** Hồ sơ cấu hình vận hành mặc định cho từng loại hàng đợi theo tính chất công việc. */
export const QUEUE_PROFILES: Record<QueueName, QueueProfile> = {
  [QUEUES.SYSTEM_CRITICAL]: {
    name: QUEUES.SYSTEM_CRITICAL,
    description: 'Tác vụ khẩn cấp cần xử lý tức thời (OTP, cảnh báo bảo mật, thu hồi phiên)',
    defaultPriority: JOB_PRIORITIES.CRITICAL,
    defaultAttempts: 3,
    defaultBackoff: 'exponential',
    defaultBackoffDelayMs: 500,
    defaultTimeoutMs: 15_000,
    defaultConcurrency: 10,
    lockDurationMs: 15_000,
  },
  [QUEUES.SYSTEM_NOTIFICATIONS]: {
    name: QUEUES.SYSTEM_NOTIFICATIONS,
    description: 'Hàng đợi gửi Email, SMS, Push Notification đơn lẻ hoặc theo lô (batch)',
    defaultPriority: JOB_PRIORITIES.HIGH,
    defaultAttempts: 4,
    defaultBackoff: 'exponential',
    defaultBackoffDelayMs: 1_000,
    defaultTimeoutMs: 30_000,
    defaultConcurrency: 8,
    lockDurationMs: 30_000,
  },
  [QUEUES.SYSTEM_EVENTS]: {
    name: QUEUES.SYSTEM_EVENTS,
    description: 'Hàng đợi sự kiện hệ thống và tác vụ nền mặc định',
    defaultPriority: JOB_PRIORITIES.NORMAL,
    defaultAttempts: 3,
    defaultBackoff: 'exponential',
    defaultBackoffDelayMs: 1_000,
    defaultTimeoutMs: 60_000,
    defaultConcurrency: 5,
    lockDurationMs: JOB_LOCK_DURATION_MS,
  },
  [QUEUES.SYSTEM_HEAVY]: {
    name: QUEUES.SYSTEM_HEAVY,
    description: 'Hàng đợi công việc nặng tốn tài nguyên (Import/Export CSV-XLSX, xử lý ảnh/media)',
    defaultPriority: JOB_PRIORITIES.LOW,
    defaultAttempts: 2,
    defaultBackoff: 'fixed',
    defaultBackoffDelayMs: 3_000,
    defaultTimeoutMs: 300_000,
    defaultConcurrency: 2,
    lockDurationMs: 60_000,
  },
};

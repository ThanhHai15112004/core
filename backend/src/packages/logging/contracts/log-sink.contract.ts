export type LogEntryLevel = 'debug' | 'verbose' | 'info' | 'warn' | 'error' | 'fatal';

export const LOG_ENTRY_LEVELS: LogEntryLevel[] = [
  'verbose',
  'debug',
  'info',
  'warn',
  'error',
  'fatal',
];

export type LogMetadataValue = string | number | boolean | null | LogMetadataValue[] | LogMetadata;
export interface LogMetadata {
  [key: string]: LogMetadataValue;
}

/**
 * Một log có cấu trúc (đã redact trước khi rời process). Không log nào có đủ mọi field — chỉ những gì biết được từ
 * context lúc ghi: request HTTP, job đang xử lý, lần chạy Scheduler…
 */
export interface LogEntry {
  /** ID duy nhất (thời gian base36 + ngẫu nhiên) — dùng cho link chi tiết và cursor. */
  id?: string;
  /** ISO 8601 */
  t: string;
  level: LogEntryLevel;
  /** Nội dung chính (một dòng; stack trace tách riêng ở `stack`). */
  message: string;
  /** Module / class ghi log (Nest context), vd. `ReportProcessor`. */
  context?: string;
  /** Runtime và instance (`host:pid`) — do sink gắn. */
  runtime?: string;
  instance?: string;
  /** Có khi log phát sinh trong một HTTP request / chuỗi xử lý — dùng để nối Traffic → Logs. */
  correlationId?: string;
  /** ID request HTTP (Traffic) khi log phát sinh trong request. */
  requestId?: string;
  /** Có khi log phát sinh lúc worker xử lý một job — dùng để nối Jobs → Logs. */
  jobId?: string;
  /** Loại job (topic) đang xử lý. */
  jobType?: string;
  messageId?: string;
  /** Lần chạy Scheduler. */
  executionId?: string;
  userId?: string;
  /** `METHOD /route` của request đang xử lý. */
  route?: string;
  errorType?: string;
  errorCode?: string;
  stack?: string;
  durationMs?: number;
  /** Nhóm lỗi (warn/error/fatal có lỗi) — cùng loại lỗi + module + message đã chuẩn hoá + vị trí stack. */
  fingerprint?: string;
  metadata?: LogMetadata;
}

/** Đích phụ nhận log (vd. Redis ring buffer của runtime) — ngoài console. */
export interface LogSink {
  write(entry: LogEntry): void;
}

export const LOG_SINK = Symbol('LOG_SINK');

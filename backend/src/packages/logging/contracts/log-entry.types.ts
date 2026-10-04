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
 * Một log đã chuẩn hoá từ dòng JSON pino trong Redis Stream (xem `utils/log-entry.ts`). Không log nào có đủ mọi
 * field — chỉ những gì biết được từ context lúc ghi: request HTTP, job đang xử lý, lần chạy Scheduler…
 */
export interface LogEntry {
  /** ID trong Redis Stream (`<ms>-<seq>`) — dùng cho link chi tiết và cursor. */
  id?: string;
  /** ISO 8601 */
  t: string;
  level: LogEntryLevel;
  /** Nội dung chính (một dòng; stack trace tách riêng ở `stack`). */
  message: string;
  /** Module / class ghi log (Nest context), vd. `ReportProcessor`. */
  context?: string;
  /** Runtime và instance (`host:pid`). */
  runtime?: string;
  instance?: string;
  correlationId?: string;
  /** ID request HTTP (pino-http `reqId`). */
  requestId?: string;
  jobId?: string;
  jobType?: string;
  messageId?: string;
  executionId?: string;
  userId?: string;
  /** `METHOD /route` của request. */
  route?: string;
  errorType?: string;
  errorCode?: string;
  stack?: string;
  durationMs?: number;
  /** Nhóm lỗi (warn/error/fatal có lỗi) — loại lỗi + module + message đã chuẩn hoá. */
  fingerprint?: string;
  metadata?: LogMetadata;
}

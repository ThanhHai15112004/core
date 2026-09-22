export type LogEntryLevel = 'debug' | 'verbose' | 'info' | 'warn' | 'error' | 'fatal';

export interface LogEntry {
  /** ISO 8601 */
  t: string;
  level: LogEntryLevel;
  context?: string;
  /** Có khi log phát sinh trong một HTTP request — dùng để nối Traffic → Logs. */
  correlationId?: string;
  message: string;
}

/** Đích phụ nhận log (vd. Redis ring buffer của runtime) — ngoài console. */
export interface LogSink {
  write(entry: LogEntry): void;
}

export const LOG_SINK = Symbol('LOG_SINK');

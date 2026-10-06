import type { AuditDomain, LogFilters, LogLevel, LogsRange, LogsTab, LogsWindow, OverrideLevel } from '../types/logs.types';
import type { StatusTone } from '../utils/status-tone';

export const LOGS_TABS: LogsTab[] = ['overview', 'explorer', 'errors', 'traces', 'audit', 'configuration'];
export const LOGS_RANGES: LogsRange[] = ['15m', '1h', '6h', '24h', '7d'];
export const DEFAULT_LOGS_RANGE: LogsRange = '1h';
export const LOGS_WINDOWS: LogsWindow[] = ['5m', '15m', '1h', '6h', '24h', '7d'];
export const DEFAULT_LOGS_WINDOW: LogsWindow = '1h';
export const RUNTIMES = ['api', 'worker', 'scheduler', 'cli'] as const;
export const OVERRIDE_LEVELS: OverrideLevel[] = ['DEBUG', 'INFO', 'WARN'];
export const LEVEL_DURATIONS = [15, 30, 60, 120] as const;
export const AUDIT_DOMAINS: AuditDomain[] = ['cache', 'storage', 'queue', 'messaging', 'scheduler', 'jobs', 'database', 'runtime', 'logs'];
/** Rolling buffer của live mode — trình duyệt không giữ log vô hạn; log cũ hơn tìm qua backend. */
export const LIVE_BUFFER_SIZES = [500, 1000, 2000] as const;
export const DEFAULT_LIVE_BUFFER = 1000;
export const LIVE_POLL_MS = 2000;

/** Field lọc nằm trên URL (thứ tự = thứ tự hiện chip). */
export const FILTER_KEYS: (keyof LogFilters)[] = [
  'q',
  'level',
  'runtime',
  'module',
  'correlationId',
  'requestId',
  'jobId',
  'messageId',
  'executionId',
  'userId',
  'id',
  'status',
  'endpoint',
  'errorType',
  'instance',
  'fingerprint',
  'window',
  'from',
  'to',
];
/** More Filters. */
export const MORE_FILTER_KEYS = [
  'correlationId',
  'requestId',
  'jobId',
  'messageId',
  'executionId',
  'userId',
  'status',
  'endpoint',
  'errorType',
  'instance',
] as const;

export const LEVEL_TONE: Record<LogLevel, StatusTone> = {
  fatal: 'crit',
  error: 'crit',
  warn: 'warn',
  info: 'unknown',
  debug: 'unknown',
  verbose: 'unknown',
};

export const LOGS_STATUS_TONE: Record<string, StatusTone> = {
  streaming: 'ok',
  idle: 'unknown',
  degraded: 'warn',
  unavailable: 'crit',
};

export const ISSUE_TONE: Record<string, StatusTone> = {
  ok: 'ok',
  info: 'unknown',
  warning: 'warn',
  critical: 'crit',
};

/** Loại lỗi / metadata → màn hạ tầng tương ứng. */
export const DEPENDENCY_SECTION: Record<string, string> = {
  database: 'database',
  cache: 'cache',
  storage: 'storage',
  messaging: 'messaging',
  http: 'http-traffic',
};

/** Audit domain → màn quản lý. */
export const AUDIT_SECTION: Record<AuditDomain, string> = {
  cache: 'cache',
  storage: 'storage',
  queue: 'worker',
  messaging: 'messaging',
  scheduler: 'scheduler',
  jobs: 'jobs',
  database: 'database',
  runtime: 'runtimes',
  logs: 'logs/configuration',
};

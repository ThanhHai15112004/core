import type { LogFilters, LogsRange } from '../../types/logs.types';

/** Query key của Logs — prefix `['logs']` để invalidate cả trang sau thao tác. */
export const logsKeys = {
  all: ['logs'] as const,
  overview: (range: LogsRange) => ['logs', 'overview', range] as const,
  series: (range: LogsRange) => ['logs', 'series', range] as const,
  report: () => ['logs', 'report'] as const,
  errors: (range: LogsRange, q: string) => ['logs', 'errors', range, q] as const,
  errorGroup: (fp: string, range: LogsRange) => ['logs', 'error-group', fp, range] as const,
  entry: (id: string) => ['logs', 'entry', id] as const,
  trace: (id: string) => ['logs', 'trace', id] as const,
  recentFailing: () => ['logs', 'recent-failing'] as const,
  audit: (q: object) => ['logs', 'audit', q] as const,
  config: () => ['logs', 'config'] as const,
  search: (f: LogFilters) => ['logs', 'search', f] as const,
};

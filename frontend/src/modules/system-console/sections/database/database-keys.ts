import type { DbMetric, DbRange } from '../../types/database.types';

/** Query key của Database — prefix `['database']` để invalidate cả trang sau thao tác. */
export const dbKeys = {
  all: ['database'] as const,
  overview: (range: DbRange) => ['database', 'overview', range] as const,
  metrics: (range: DbRange, metric: DbMetric) => ['database', 'metrics', range, metric] as const,
  live: () => ['database', 'live'] as const,
  stats: (range: DbRange, minMs: number) => ['database', 'stats', range, minMs] as const,
  query: (id: string, range: DbRange) => ['database', 'query', id, range] as const,
  explain: (id: string) => ['database', 'explain', id] as const,
  connections: () => ['database', 'connections'] as const,
  connection: (id: string) => ['database', 'connection', id] as const,
  transactions: () => ['database', 'transactions'] as const,
  tables: () => ['database', 'tables'] as const,
  table: (name: string) => ['database', 'table', name] as const,
  storage: () => ['database', 'storage'] as const,
  migrations: () => ['database', 'migrations'] as const,
  errors: (range: DbRange) => ['database', 'errors', range] as const,
  events: (range: DbRange) => ['database', 'events', range] as const,
  config: () => ['database', 'config'] as const,
};

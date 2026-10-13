import type { CacheMetric, CacheRange, KeyFilter } from '../../types/cache.types';

/** Query key của Cache — prefix `['cache']` để invalidate cả trang sau thao tác. */
export const cacheKeys = {
  all: ['cache'] as const,
  overview: (range: CacheRange) => ['cache', 'overview', range] as const,
  metrics: (range: CacheRange, metric: CacheMetric) => ['cache', 'metrics', range, metric] as const,
  namespaces: () => ['cache', 'namespaces'] as const,
  namespace: (name: string) => ['cache', 'namespace', name] as const,
  keys: (filter: KeyFilter) => ['cache', 'keys', filter] as const,
  key: (key: string) => ['cache', 'key', key] as const,
  memory: () => ['cache', 'memory'] as const,
  clients: () => ['cache', 'clients'] as const,
  events: (range: CacheRange) => ['cache', 'events', range] as const,
  errors: (range: CacheRange) => ['cache', 'errors', range] as const,
  operations: () => ['cache', 'operations'] as const,
  config: () => ['cache', 'config'] as const,
  flushImpact: () => ['cache', 'flush-impact'] as const,
};

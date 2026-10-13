import type { MetricRange, RuntimeId } from '../../types/runtime.types';

/** Query key của Runtimes — prefix `['runtimes']` để làm mới cả trang sau Stop/Start. */
export const runtimesKeys = {
  all: ['runtimes'] as const,
  overview: () => ['runtimes', 'overview'] as const,
  detail: (id: RuntimeId) => ['runtimes', 'detail', id] as const,
  series: (range: MetricRange) => ['runtimes', 'series', range] as const,
  runtimeSeries: (id: RuntimeId, range: MetricRange) => ['runtimes', 'series', id, range] as const,
  events: (limit: number, id?: RuntimeId) => ['runtimes', 'events', id ?? 'all', limit] as const,
  logs: (id: RuntimeId | 'cli', limit: number, level: string) => ['runtimes', 'logs', id, limit, level] as const,
};

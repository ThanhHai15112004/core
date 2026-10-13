import type { TimeseriesMetric, TrafficFilters } from '../../types/traffic.types';

/** Phần bộ lọc gửi lên API (range + method + nội bộ) — lọc status / tìm kiếm làm ở client. */
const scope = (f: TrafficFilters) => [f.range, f.method ?? null, f.internal] as const;

/** Query key của HTTP Traffic — prefix `['traffic']`. */
export const trafficKeys = {
  all: ['traffic'] as const,
  summary: (f: TrafficFilters) => ['traffic', 'summary', ...scope(f)] as const,
  timeseries: (f: TrafficFilters, metric: TimeseriesMetric, routeId?: string) => ['traffic', 'timeseries', metric, routeId ?? null, ...scope(f)] as const,
  endpoints: (f: TrafficFilters) => ['traffic', 'endpoints', ...scope(f)] as const,
  endpoint: (routeId: string, range: TrafficFilters['range']) => ['traffic', 'endpoint', routeId, range] as const,
  errors: (f: TrafficFilters) => ['traffic', 'errors', ...scope(f)] as const,
  insights: (f: TrafficFilters) => ['traffic', 'insights', ...scope(f)] as const,
};

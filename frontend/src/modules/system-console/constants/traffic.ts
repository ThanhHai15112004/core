import type { EndpointSort, RequestKind, TimeseriesMetric, TrafficRange } from '../types/traffic.types';

export const TRAFFIC_TABS = ['overview', 'endpoints', 'requests', 'slow', 'errors'] as const;
export type TrafficTab = (typeof TRAFFIC_TABS)[number];

export const ENDPOINT_TABS = ['overview', 'requests', 'errors', 'latency', 'status'] as const;
export type EndpointTab = (typeof ENDPOINT_TABS)[number];

export const TRAFFIC_RANGES: TrafficRange[] = ['5m', '15m', '1h', '6h', '24h', '7d'];
export const DEFAULT_RANGE: TrafficRange = '15m';
export const CHART_METRICS: TimeseriesMetric[] = ['requests', 'latency', 'errors', 'status'];
export const ENDPOINT_SORTS: EndpointSort[] = ['traffic', 'latency', 'p95', 'errors'];
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const STATUS_FILTERS = ['2xx', '3xx', '4xx', '5xx'] as const;
/** Mốc lọc request chậm (ms). */
export const SLOW_THRESHOLDS = [250, 500, 1000, 3000] as const;
export const REQUEST_KINDS: RequestKind[] = ['failed', 'slow', 'notable'];

/** Số request mỗi trang của bảng request. */
export const REQUEST_PAGE_SIZE = 50;
/** Số endpoint hiển thị ở tab Overview. */
export const OVERVIEW_ENDPOINT_LIMIT = 8;
/** Số request chậm/lỗi gần nhất ở tab Overview. */
export const OVERVIEW_REQUEST_LIMIT = 10;
/** Cận trên histogram latency phía backend — giá trị bằng mốc này nghĩa là "≥". */
export const LATENCY_CEILING_MS = 10_000;

export const SERIES_COLORS: Record<string, string> = {
  requests: 'var(--scp-series-1)',
  p50: 'var(--scp-series-1)',
  p95: 'var(--scp-series-2)',
  p99: 'var(--scp-series-3)',
  '2xx': 'var(--scp-success)',
  '3xx': 'var(--scp-info)',
  '4xx': 'var(--scp-warning)',
  '5xx': 'var(--scp-danger)',
};

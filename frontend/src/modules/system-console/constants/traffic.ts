import type { Tone } from '@core/theme';
import type { ChartColor } from '@core/ui/charts';
import type { TabAlias } from '../shell/useSectionRoute';
import type { EndpointStatus, StatusClass, TimeseriesMetric, TrafficRange } from '../types/traffic.types';

/** Tab của HTTP Traffic (chi tiết endpoint là trang con `endpoints/<routeId>`). */
export const TRAFFIC_TABS = ['overview', 'endpoints', 'errors'] as const;
export type TrafficTab = (typeof TRAFFIC_TABS)[number];

/** Link cũ: `requests` (danh sách request đã bỏ) → Endpoints; `slow` → Endpoints sắp theo P95. */
export const TRAFFIC_TAB_ALIASES: Partial<Record<string, TabAlias<TrafficTab>>> = {
  requests: { tab: 'endpoints' },
  slow: { tab: 'endpoints', query: { sort: 'p95' } },
};

/** Khoảng thời gian API traffic hỗ trợ. */
export const TRAFFIC_RANGES = ['5m', '15m', '1h', '6h', '24h', '7d'] as const satisfies readonly TrafficRange[];

export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** Phạm vi traffic: `all` gồm cả traffic nội bộ (System Console, health); `app` bỏ phần đó. */
export const TRAFFIC_SCOPES = ['all', 'app'] as const;
export type TrafficScope = (typeof TRAFFIC_SCOPES)[number];

/** Lọc bảng endpoint: theo trạng thái backend suy ra, hoặc có lỗi 4xx / 5xx. */
export const ENDPOINT_STATUS_FILTERS = ['failing', 'high_error', 'slow', 'healthy', 'low_traffic', 'idle', '5xx', '4xx'] as const;
export type EndpointStatusFilter = (typeof ENDPOINT_STATUS_FILTERS)[number];

/** Sort cũ trên URL (`?sort=`) → cột của bảng endpoint. */
export const SORT_COLUMN: Record<string, string> = {
  traffic: 'rps',
  latency: 'avg',
  p95: 'p95',
  errors: 'serverRate',
};
export const DEFAULT_SORT_COLUMN = 'rps';

export const ENDPOINT_TONE: Record<EndpointStatus, Tone> = {
  healthy: 'ok',
  slow: 'warn',
  high_error: 'warn',
  failing: 'crit',
  idle: 'unknown',
  low_traffic: 'unknown',
};

export const METHOD_TONE: Record<string, Tone> = {
  GET: 'info',
  POST: 'ok',
  PUT: 'warn',
  PATCH: 'warn',
  DELETE: 'crit',
};

export const STATUS_CLASS_TONE: Record<StatusClass, Tone> = {
  '2xx': 'ok',
  '3xx': 'info',
  '4xx': 'warn',
  '5xx': 'crit',
};

/** Màu series biểu đồ theo id series backend trả về. */
export const SERIES_COLOR: Record<string, ChartColor> = {
  requests: 'series-1',
  errors: 'crit',
  p50: 'series-1',
  p95: 'series-2',
  p99: 'series-3',
  '2xx': 'ok',
  '3xx': 'info',
  '4xx': 'warn',
  '5xx': 'crit',
};
/** Thứ tự vẽ series latency (backend trả P95 trước để tính số tóm tắt). */
export const LATENCY_SERIES_ORDER = ['p50', 'p95', 'p99'];

/** Biểu đồ tổng quan: lưu lượng (đổi được sang tỷ lệ lỗi). */
export const TRAFFIC_CHART_METRICS: TimeseriesMetric[] = ['requests', 'errors'];

/** Status 401 / 403 / 429 coi là tín hiệu bảo mật. */
export const SECURITY_TONE: Record<number, Tone> = { 401: 'warn', 403: 'warn', 429: 'crit' };

/** Số mục trong danh sách "top" (endpoint chậm / lỗi, status). */
export const TOP_LIST_SIZE = 6;
/** Chiều cao tối đa bảng endpoint (px) — cuộn trong bảng, header dính. */
export const ENDPOINT_TABLE_MAX_HEIGHT_PX = 640;

/** Mã lỗi backend khi chưa bật thu thập metric request. */
export const TELEMETRY_DISABLED_CODE = 'TRAFFIC_TELEMETRY_DISABLED';
/** HTTP status khi không có telemetry (Prometheus không trả lời). */
export const TELEMETRY_UNAVAILABLE_STATUS = 503;

/** Cận trên histogram latency phía backend — giá trị bằng mốc này nghĩa là "≥". */
export const LATENCY_CEILING_MS = 10_000;

import type { Tone } from '@core/theme';
import type { ChartColor } from '@core/ui/charts';
import type { BaselineMode, ComponentId, ComponentStatus, PerfLevel, PerfMetric, PerfRange } from '../types/performance.types';

/** Tab của Performance (chi tiết thành phần mở drawer `?item=<id>`). */
export const PERF_TABS = ['overview', 'bottlenecks', 'events'] as const;
export type PerfTab = (typeof PERF_TABS)[number];

/** Khoảng thời gian API hiệu năng hỗ trợ. */
export const PERF_RANGES = ['5m', '15m', '1h', '6h', '24h', '7d'] as const satisfies readonly PerfRange[];

export const PERF_METRICS: PerfMetric[] = ['latency', 'throughput', 'cpu', 'memory', 'errors', 'eventLoop', 'gc', 'dbLatency', 'queueDepth'];
/** Nút chọn nhanh trên biểu đồ; các chỉ số còn lại nằm trong ô chọn "Chỉ số khác". */
export const PRIMARY_METRICS: PerfMetric[] = ['latency', 'throughput', 'cpu', 'memory', 'errors'];
export const EXTRA_METRICS: PerfMetric[] = PERF_METRICS.filter((m) => !PRIMARY_METRICS.includes(m));
export const DEFAULT_PERF_METRIC: PerfMetric = 'latency';
export const BASELINE_MODES: BaselineMode[] = ['previous', 'yesterday', 'lastWeek'];
export const COMPONENT_IDS: ComponentId[] = ['api', 'database', 'cache', 'worker', 'messaging'];

export const LEVEL_TONE: Record<PerfLevel, Tone> = { normal: 'ok', degraded: 'warn', critical: 'crit', unknown: 'unknown' };
export const COMPONENT_TONE: Record<ComponentStatus, Tone> = { normal: 'ok', degraded: 'warn', critical: 'crit', idle: 'unknown', unavailable: 'unknown' };
export const SEVERITY_TONE: Record<'info' | 'warning' | 'critical' | 'success', Tone> = { info: 'info', warning: 'warn', critical: 'crit', success: 'ok' };

/** Rule nghẽn ứng với từng KPI (tô màu ô KPI khi rule đang vi phạm). */
export const KPI_RULES = {
  apiP95: ['API_LATENCY_P95', 'API_LATENCY_P99'],
  cpu: ['CPU_HIGH'],
  memory: ['MEMORY_HIGH', 'MEMORY_GROWTH'],
  errorRate: ['API_ERROR_RATE'],
} as const;

/** Màu series theo id; series không có trong bảng dùng màu theo thứ tự. */
export const PERF_SERIES_COLORS: Record<string, ChartColor> = {
  p50: 'series-1',
  p95: 'series-2',
  p99: 'series-3',
  total: 'series-2',
  http: 'series-1',
  db: 'series-3',
  cache: 'series-4',
  jobs: 'series-5',
  api: 'series-1',
  worker: 'series-3',
  scheduler: 'series-4',
  avg: 'series-1',
  waiting: 'warn',
  active: 'series-1',
};
export const COMPARE_COLOR: ChartColor = 'series-5';
export const BASELINE_COLOR: ChartColor = 'muted';

/** Chỉ số trong drawer thành phần mà tăng là xấu. */
export const HIGHER_IS_WORSE = new Set(['p50', 'p95', 'p99', 'avg', 'errorRate', 'errors', 'poolWaiting', 'maxOp', 'avgJob', 'p95Job', 'failed', 'queueWaiting']);

/** Mức dùng tài nguyên có giới hạn: từ ngưỡng này tô vàng, đầy tô đỏ. */
export const CAPACITY_WARN_PERCENT = 80;
export const CAPACITY_FULL_PERCENT = 100;

/** Số điểm nghẽn hiện ở tab Tổng quan. */
export const OVERVIEW_BOTTLENECKS = 4;
export const EVENTS_MAX_HEIGHT_PX = 640;

/** @deprecated Màu CSS cũ — chỉ còn cho các section chưa viết lại (cache, storage, worker, messaging, database). */
export const FALLBACK_COLORS = ['var(--scp-series-1)', 'var(--scp-series-2)', 'var(--scp-series-3)', 'var(--scp-series-4)'];

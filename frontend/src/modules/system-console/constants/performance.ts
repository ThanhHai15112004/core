import type { BaselineMode, ComponentId, ComponentStatus, PerfLevel, PerfMetric, PerfRange } from '../types/performance.types';
import type { StatusTone } from '../utils/status-tone';

export const PERF_RANGES: PerfRange[] = ['5m', '15m', '1h', '6h', '24h', '7d'];
export const DEFAULT_PERF_RANGE: PerfRange = '1h';
/** Khoảng "live" — cập nhật mỗi 5 giây; các khoảng dài là lịch sử đã gộp. */
export const LIVE_RANGES: PerfRange[] = ['5m', '15m', '1h'];
export const PERF_METRICS: PerfMetric[] = ['latency', 'throughput', 'cpu', 'memory', 'errors', 'eventLoop', 'gc', 'dbLatency', 'queueDepth'];
/** Tab hiển thị chính; các metric còn lại nằm trong "So sánh với". */
export const PRIMARY_METRICS: PerfMetric[] = ['latency', 'throughput', 'cpu', 'memory', 'errors'];
export const BASELINE_MODES: BaselineMode[] = ['previous', 'yesterday', 'lastWeek'];
export const COMPONENT_IDS: ComponentId[] = ['api', 'database', 'cache', 'worker', 'messaging'];

export const LEVEL_TONE: Record<PerfLevel, StatusTone> = {
  normal: 'ok',
  degraded: 'warn',
  critical: 'crit',
  unknown: 'unknown',
};

export const COMPONENT_TONE: Record<ComponentStatus, StatusTone> = {
  normal: 'ok',
  degraded: 'warn',
  critical: 'crit',
  idle: 'unknown',
  unavailable: 'unknown',
};

/** Màu series theo id; series không có trong bảng dùng màu theo thứ tự. */
export const PERF_SERIES_COLORS: Record<string, string> = {
  p50: 'var(--scp-series-1)',
  p95: 'var(--scp-series-2)',
  p99: 'var(--scp-series-3)',
  total: 'var(--scp-series-2)',
  http: 'var(--scp-series-1)',
  db: 'var(--scp-series-3)',
  cache: 'var(--scp-series-4)',
  jobs: 'var(--scp-series-5)',
  api: 'var(--scp-series-1)',
  worker: 'var(--scp-series-3)',
  scheduler: 'var(--scp-series-4)',
  avg: 'var(--scp-series-1)',
  waiting: 'var(--scp-warning)',
  active: 'var(--scp-series-1)',
};
export const FALLBACK_COLORS = ['var(--scp-series-1)', 'var(--scp-series-2)', 'var(--scp-series-3)', 'var(--scp-series-4)'];
export const COMPARE_COLOR = 'var(--scp-series-5)';
export const BASELINE_COLOR = 'var(--scp-text-muted)';

export const MARKER_COLORS: Record<string, string> = {
  info: 'var(--scp-info)',
  warning: 'var(--scp-warning)',
  critical: 'var(--scp-danger)',
  success: 'var(--scp-success)',
};

/** Số sự kiện hiển thị trước khi bấm "Xem thêm". */
export const EVENTS_PREVIEW = 8;

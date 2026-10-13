import type { ChartColor } from '@core/ui/charts';
import type { HealthMapCategory } from '../types/console.types';
import type { PerfMetric, PerfRange } from '../types/performance.types';

/** Khoảng thời gian trang Tổng quan hỗ trợ (theo API hiệu năng). */
export const OVERVIEW_RANGES = ['15m', '1h', '6h', '24h'] as const satisfies readonly PerfRange[];

/** 4 biểu đồ chính — series thật từ `/ops/performance/timeseries`. */
export const OVERVIEW_CHARTS: { metric: PerfMetric; color: ChartColor }[] = [
  { metric: 'throughput', color: 'series-6' },
  { metric: 'latency', color: 'series-2' },
  { metric: 'errors', color: 'crit' },
  { metric: 'cpu', color: 'series-3' },
];

export const HEALTH_CATEGORIES: HealthMapCategory[] = ['runtime', 'infrastructure', 'governance'];

/** KPI id của backend → nhãn i18n. */
export const KPI_LABEL_KEY: Record<string, string> = {
  req_sec: 'kpi.reqSec',
  p95_lat: 'kpi.p95Latency',
  err_rate: 'kpi.errorRate',
  cpu_load: 'kpi.cpuUsage',
  mem_usage: 'kpi.memoryUsage',
  alerts_count: 'kpi.activeAlerts',
};

/** Backend trả `--` khi chưa có số liệu. */
export const BACKEND_NO_VALUE = '--';

/** Chiều cao tối đa của danh sách hoạt động gần đây (px). */
export const ACTIVITY_MAX_HEIGHT_PX = 360;
export const KPI_SKELETON_COUNT = 6;

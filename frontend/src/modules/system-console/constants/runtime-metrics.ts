import type { LucideIcon } from 'lucide-react';
import { Clock, Cpu, Globe } from 'lucide-react';
import type { ChartColor } from '@core/ui/charts';
import type { MetricRange, RuntimeId, RuntimeSample } from '../types/runtime.types';

/** Runtime chạy lâu dài (có trang chi tiết `runtimes/<id>`). CLI chạy theo yêu cầu → chỉ có thẻ + sheet lịch sử. */
export const RUNTIME_IDS: RuntimeId[] = ['api', 'worker', 'scheduler'];
export const RUNTIME_ICON: Record<RuntimeId, LucideIcon> = { api: Globe, worker: Cpu, scheduler: Clock };
export const RUNTIME_COLOR: Record<RuntimeId, ChartColor> = { api: 'series-1', worker: 'series-2', scheduler: 'series-3' };

/** Khoảng thời gian API `/runtimes/metrics` hỗ trợ. */
export const RUNTIME_RANGES = ['15m', '1h', '6h', '24h'] as const satisfies readonly MetricRange[];

/** Tab trang chi tiết (`runtimes/<id>/<tab>`); tab đầu không ghi lên URL. */
export const RUNTIME_DETAIL_TABS = ['overview', 'metrics', 'logs'] as const;
export type RuntimeDetailTab = (typeof RUNTIME_DETAIL_TABS)[number];

/** Tab cũ → tab mới (link cũ vẫn mở được). `configuration` → mở sheet cấu hình. */
export const RUNTIME_TAB_ALIASES: Record<string, { tab: RuntimeDetailTab; query?: Record<string, string> }> = {
  processes: { tab: 'overview' },
  events: { tab: 'logs' },
  configuration: { tab: 'overview', query: { settings: '1' } },
};

/**
 * Metric riêng của từng runtime (key khớp `collectMetrics()` của contributor phía backend).
 * `card: true` → hiện trên thẻ ở trang danh sách; còn lại hiện ở trang chi tiết.
 */
export interface RuntimeMetricDef {
  key: string;
  /** Đơn vị để định dạng: `ms`, `%`, `perSec`, `perMin` hoặc bỏ trống (số đếm). */
  unit?: 'ms' | '%' | 'perSec' | 'perMin';
  card?: boolean;
  /** Giá trị là thời điểm ISO → hiển thị dạng tương đối. */
  kind?: 'time';
  /** Số > 0 là xấu (tô đỏ). */
  bad?: boolean;
}

export const RUNTIME_METRICS: Record<RuntimeId, RuntimeMetricDef[]> = {
  api: [
    { key: 'requestsPerSecond', unit: 'perSec', card: true },
    { key: 'p95LatencyMs', unit: 'ms', card: true },
    { key: 'errorRatePercent', unit: '%', card: true, bad: true },
    { key: 'activeRequests', card: true },
    { key: 'openConnections' },
    { key: 'totalRequests' },
    { key: 'errorCount', bad: true },
  ],
  worker: [
    { key: 'activeJobs', card: true },
    { key: 'waitingJobs', card: true },
    { key: 'jobsPerMinute', unit: 'perMin', card: true },
    { key: 'failedJobs', card: true, bad: true },
    { key: 'delayedJobs' },
    { key: 'completedJobs' },
    { key: 'avgJobDurationMs', unit: 'ms' },
    { key: 'consumers' },
    { key: 'concurrency' },
  ],
  scheduler: [
    { key: 'registeredTasks', card: true },
    { key: 'runningTasks', card: true },
    { key: 'failedToday', card: true, bad: true },
    { key: 'nextTaskAt', card: true, kind: 'time' },
    { key: 'runsToday' },
    { key: 'nextTaskName' },
    { key: 'lastFailedTask' },
    { key: 'lastFailedAt', kind: 'time' },
  ],
};

/** Số ô metric riêng hiện thêm trên tab Tổng quan của trang chi tiết. */
export const DETAIL_EXTRA_STATS = 2;

/** Lối tắt sang màn liên quan (đường dẫn console). */
export const RUNTIME_SHORTCUTS: Record<RuntimeId, { key: 'queues' | 'tasks'; path: string }[]> = {
  api: [],
  worker: [{ key: 'queues', path: 'worker' }],
  scheduler: [{ key: 'tasks', path: 'scheduler/tasks' }],
};

/** Ngữ cảnh "đang bận" hiện trong hộp xác nhận Stop. */
export const BUSY_METRICS: Record<RuntimeId, string[]> = {
  api: ['activeRequests'],
  worker: ['activeJobs', 'waitingJobs'],
  scheduler: ['runningTasks'],
};

/** Vượt ngưỡng cảnh báo của backend → vàng; chạm mức này (đầy) → đỏ. */
export const USAGE_FULL_PERCENT = 100;

/** Backend chỉ nhận đúng chữ này khi Stop. */
export const STOP_CONFIRM_WORD = 'STOP';

/** Theo dõi lệnh Stop/Start: hỏi trạng thái mỗi giây, tối đa 150s (RESTART_TIMEOUT_MS backend = 2 phút + dư). */
export const COMMAND_POLL_MS = 1_000;
export const COMMAND_MAX_WAIT_MS = 150_000;

/** Biểu đồ tài nguyên: chỉ số → trường trong mẫu đo. */
export const RUNTIME_CHART_METRICS = ['cpu', 'memory', 'eventLoop', 'restarts'] as const;
export type RuntimeChartMetric = (typeof RUNTIME_CHART_METRICS)[number];
export const RUNTIME_CHART_FIELD: Record<RuntimeChartMetric, keyof Omit<RuntimeSample, 't'>> = {
  cpu: 'cpu',
  memory: 'mem',
  eventLoop: 'elp99',
  restarts: 'restarts',
};

/** Số sự kiện / log tải cho từng chỗ hiển thị. */
export const LIST_EVENTS_LIMIT = 20;
export const DETAIL_EVENTS_PREVIEW = 8;
export const DETAIL_EVENTS_LIMIT = 50;
export const DETAIL_LOGS_LIMIT = 200;
export const CLI_LOGS_LIMIT = 50;

/** Chiều cao danh sách cuộn (px). */
export const EVENTS_MAX_HEIGHT_PX = 360;
export const LOGS_MAX_HEIGHT_PX = 480;

/** Lọc log theo level ('' = tất cả). */
export const RUNTIME_LOG_LEVELS = ['', 'error', 'warn', 'info', 'debug'] as const;
export type RuntimeLogLevel = (typeof RUNTIME_LOG_LEVELS)[number];

/** Lý do restart coi là bất thường (tô đỏ). */
export const BAD_RESTART_CODES = ['crash', 'unexpected'];

/** Lịch sử restart / queue: cột số đếm của queue trong chi tiết worker. */
export const QUEUE_COUNT_KEYS = ['active', 'waiting', 'delayed', 'failed', 'completed'] as const;

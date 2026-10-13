import type { Tone } from '@core/theme';
import type { ChartColor } from '@core/ui/charts';
import type {
  BackgroundStatus,
  DelayReason,
  JobState,
  QueueDetailTab,
  QueueStatus,
  WorkerEvent,
  WorkerInstanceStatus,
  WorkerMetric,
  WorkerRange,
} from '../types/worker.types';

/** Tab của Worker & Queue (cấu hình mở dạng sheet ⚙). */
export const WORKER_PAGE_TABS = ['overview', 'queues', 'workers', 'activity'] as const;
export type WorkerPageTab = (typeof WORKER_PAGE_TABS)[number];

/** Segment của tab "Lỗi & Hoạt động" (`worker/activity?view=`). */
export const ACTIVITY_VIEWS = ['failures', 'delayed', 'events', 'operations'] as const;
export type ActivityView = (typeof ACTIVITY_VIEWS)[number];

/** Tab của trang chi tiết queue `worker/queues/<name>/<tab>`. */
export const QUEUE_PAGE_TABS = ['overview', 'jobs', 'failures'] as const;
export type QueuePageTab = (typeof QUEUE_PAGE_TABS)[number];

/**
 * Link cũ → tab mới. Tab con cũ của trang queue (`workers`, `metrics`, `configuration`) gộp vào Tổng quan của queue.
 * Cảnh báo / sự kiện từ backend vẫn mang tên tab cũ (`WorkerTab`) nên dùng chung bảng này.
 */
export const WORKER_TAB_ALIASES = {
  failures: { tab: 'activity', query: { view: 'failures' } },
  delayed: { tab: 'activity', query: { view: 'delayed' } },
  events: { tab: 'activity', query: { view: 'events' } },
  configuration: { tab: 'overview', query: { settings: '1' } },
} as const satisfies Record<string, { tab: WorkerPageTab; query?: Record<string, string> }>;

export const QUEUE_SUB_ALIASES: Record<string, QueuePageTab> = {
  workers: 'overview',
  metrics: 'overview',
  configuration: 'overview',
} satisfies Partial<Record<QueueDetailTab, QueuePageTab>>;

export const WORKER_RANGES = ['15m', '1h', '6h', '24h'] as const satisfies readonly WorkerRange[];
export const WORKER_METRICS: WorkerMetric[] = ['throughput', 'waiting', 'duration', 'failures', 'retries'];
/** Biểu đồ trong tab lỗi chỉ cần hai chỉ số này. */
export const FAILURE_METRICS: WorkerMetric[] = ['failures', 'retries'];

/** Trạng thái job hiển thị (provider không hỗ trợ trạng thái nào thì không có job ở trạng thái đó). */
export const JOB_STATES: JobState[] = ['waiting', 'prioritized', 'active', 'delayed', 'retrying', 'completed', 'failed'];
export const DEFAULT_JOB_STATES: JobState[] = ['active', 'waiting', 'failed'];
export const DELAY_REASONS: DelayReason[] = ['retry', 'repeat', 'delay'];
/** Số job tối đa mỗi trạng thái khi xem job của một queue. */
export const QUEUE_JOBS_LIMIT = 50;

export const BACKGROUND_TONE: Record<BackgroundStatus, Tone> = {
  healthy: 'ok',
  degraded: 'warn',
  recovering: 'warn',
  paused: 'unknown',
  down: 'crit',
  unknown: 'unknown',
};

export const QUEUE_STATUS_TONE: Record<QueueStatus, Tone> = {
  healthy: 'ok',
  backlog: 'warn',
  high_failure: 'warn',
  slow: 'warn',
  paused: 'unknown',
  no_consumer: 'crit',
  idle: 'unknown',
};

/** Thứ tự "cần chú ý trước" của queue (nhỏ = nặng hơn). */
export const QUEUE_STATUS_RANK: Record<QueueStatus, number> = {
  no_consumer: 0,
  high_failure: 1,
  backlog: 2,
  slow: 3,
  paused: 4,
  healthy: 5,
  idle: 6,
};

export const WORKER_STATUS_TONE: Record<WorkerInstanceStatus, Tone> = {
  healthy: 'ok',
  busy: 'warn',
  high_memory: 'warn',
  high_cpu: 'warn',
  paused: 'unknown',
};

export const JOB_STATE_TONE: Record<JobState, Tone> = {
  waiting: 'unknown',
  prioritized: 'info',
  active: 'info',
  delayed: 'unknown',
  retrying: 'warn',
  completed: 'ok',
  failed: 'crit',
};

export const EVENT_TONE: Record<WorkerEvent['severity'], Tone> = { info: 'info', warning: 'warn', critical: 'crit', success: 'ok' };
export const SEVERITY_TONE: Record<string, Tone> = { critical: 'crit', warning: 'warn', info: 'info' };

/** Màu series biểu đồ theo id series của backend. */
export const WORKER_SERIES_COLOR: Record<string, ChartColor> = {
  incoming: 'series-1',
  completed: 'ok',
  failed: 'crit',
  waiting: 'warn',
  active: 'series-4',
  delayed: 'series-3',
  processingAvg: 'series-1',
  processingP95: 'series-2',
  processingP99: 'series-3',
  waitP95: 'warn',
  exhausted: 'series-5',
  retried: 'warn',
  recovered: 'ok',
};

/**
 * Màu series cho biểu đồ cũ (`components/worker/WorkerChart`, còn được trang Jobs dùng).
 * Xoá cùng `WorkerChart` khi Jobs chuyển sang bộ chart chung.
 */
export const WORKER_SERIES_COLORS: Record<string, string> = {
  incoming: 'var(--scp-series-1)',
  completed: 'var(--scp-series-4)',
  failed: 'var(--scp-danger)',
  waiting: 'var(--scp-warning)',
  active: 'var(--scp-series-4)',
  delayed: 'var(--scp-series-3)',
  processingAvg: 'var(--scp-series-1)',
  processingP95: 'var(--scp-series-2)',
  processingP99: 'var(--scp-series-3)',
  waitP95: 'var(--scp-warning)',
  exhausted: 'var(--scp-series-5)',
  retried: 'var(--scp-warning)',
  recovered: 'var(--scp-series-4)',
};

/** Ngưỡng hiển thị phía giao diện (cảnh báo thật do backend tính). */
export const CONCURRENCY_WARN_PERCENT = 90;
export const DISTRIBUTION_WARN_PERCENT = 80;
/** Queue tăng nhanh hơn mức này (job/phút) mới ghi chú "đang tăng". */
export const GROWTH_NOTE_MIN_PER_MIN = 0.5;
/** Số queue trên bảng rút gọn của Tổng quan. */
export const OVERVIEW_QUEUE_LIMIT = 6;
/** Chiều cao tối đa của danh sách dài (px). */
export const JOB_TABLE_MAX_HEIGHT_PX = 520;
export const FEED_MAX_HEIGHT_PX = 640;

/** Từ phải gõ để xác nhận drain (backend kiểm tra cùng chuỗi). */
export const DRAIN_CONFIRM = 'DRAIN';

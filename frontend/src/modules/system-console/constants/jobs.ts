import type { Tone } from '@core/theme';
import type { ChartColor } from '@core/ui/charts';
import type { TabAlias } from '../shell/useSectionRoute';
import type {
  Attempt,
  JobCapability,
  JobEvent,
  JobPriorityLevel,
  JobProblem,
  JobSourceKind,
  JobStatus,
  JobsRange,
  JobsStatusValue,
  JobsWindow,
  LifecycleKind,
  StatusFilter,
} from '../types/jobs.types';
import type { WorkerMetric } from '../types/worker.types';

/** Tab của trang Jobs (Job Detail là trang con `jobs/job/<id>`, cấu hình mở dạng sheet). */
export const JOBS_TABS = ['overview', 'explorer', 'failures', 'activity'] as const;
export type JobsPageTab = (typeof JOBS_TABS)[number];

/** Link cũ → tab mới. */
export const JOBS_TAB_ALIASES: Partial<Record<string, TabAlias<JobsPageTab>>> = {
  performance: { tab: 'overview' },
  events: { tab: 'activity' },
  configuration: { tab: 'overview', query: { settings: '1' } },
};

/** Tab của Job Detail (`jobs/job/<id>/<tab>`). */
export const JOB_DETAIL_TABS = ['overview', 'attempts', 'payload'] as const;
export type JobDetailPageTab = (typeof JOB_DETAIL_TABS)[number];
/** Tab con cũ của Job Detail → tab mới. */
export const JOB_DETAIL_ALIASES: Record<string, JobDetailPageTab> = {
  lifecycle: 'attempts',
  logs: 'payload',
  configuration: 'overview',
};

export const JOBS_RANGES: JobsRange[] = ['15m', '1h', '6h', '24h'];
export const JOBS_WINDOWS: JobsWindow[] = ['15m', '1h', '6h', '24h', '7d'];
/** Bộ lọc trạng thái của Explorer. */
export const STATUS_FILTERS: StatusFilter[] = ['all', 'active', 'waiting', 'failed', 'retrying', 'delayed', 'stalled', 'completed', 'cancelled'];
/** Bộ lọc thời gian chỉ áp dụng cho job đã kết thúc. */
export const FINISHED_FILTERS: StatusFilter[] = ['all', 'completed', 'failed', 'cancelled'];
export const JOB_SOURCES: JobSourceKind[] = ['http', 'scheduler', 'job', 'manual', 'system'];
export const JOB_PRIORITIES: JobPriorityLevel[] = ['critical', 'high', 'normal', 'low'];
/** Tab trạng thái cần capability nào của provider. */
export const STATUS_CAPABILITY: Partial<Record<StatusFilter, JobCapability>> = {
  stalled: 'stalled',
  delayed: 'delayed',
};

/** Bộ lọc Explorer trên URL (thứ tự = thứ tự chip). `q` = ô tìm kiếm. */
export const JOB_FILTER_KEYS = ['status', 'q', 'queue', 'type', 'window', 'worker', 'source', 'minAttempts', 'minDurationMs', 'errorType', 'priority'] as const;
export type JobFilterKey = (typeof JOB_FILTER_KEYS)[number];
/** Bộ lọc trong popover "Thêm bộ lọc". */
export const MORE_FILTER_KEYS: JobFilterKey[] = ['worker', 'source', 'minAttempts', 'minDurationMs', 'errorType', 'priority'];

export const JOB_STATUS_TONE: Record<JobStatus, Tone> = {
  waiting: 'unknown',
  active: 'ok',
  completed: 'ok',
  failed: 'crit',
  retrying: 'warn',
  delayed: 'info',
  stalled: 'warn',
  cancelled: 'unknown',
};

export const JOBS_STATUS_TONE: Record<JobsStatusValue, Tone> = {
  processing: 'ok',
  idle: 'unknown',
  degraded: 'warn',
  critical: 'crit',
  unavailable: 'crit',
};

export const PROBLEM_TONE: Record<JobProblem['severity'], Tone> = { warning: 'warn', critical: 'crit' };
export const EVENT_TONE: Record<JobEvent['severity'], Tone> = { info: 'info', warning: 'warn', critical: 'crit', success: 'ok' };
export const ATTEMPT_TONE: Record<Attempt['result'], Tone> = { completed: 'ok', failed: 'crit', running: 'info', cancelled: 'unknown', unknown: 'unknown' };
export const LIFECYCLE_TONE: Partial<Record<LifecycleKind, Tone>> = {
  completed: 'ok',
  failed: 'crit',
  exhausted: 'crit',
  retry_scheduled: 'warn',
  stalled: 'warn',
  cancel_requested: 'warn',
  running: 'info',
  picked: 'info',
};
export const PHASE_TONE: Record<'done' | 'active' | 'pending' | 'failed', Tone> = { done: 'ok', active: 'info', pending: 'unknown', failed: 'crit' };

/** Vấn đề trỏ thẳng tới một job cụ thể (mở Job Detail thay vì Explorer). */
export const PROBLEM_JOB_CODES = new Set(['LONG_RUNNING', 'OLDEST_WAITING', 'STALLED']);

/** Trang hạ tầng tương ứng hệ phụ thuộc gây lỗi. */
export const DEPENDENCY_PATH: Record<string, string> = {
  database: 'database',
  cache: 'cache',
  storage: 'storage',
  messaging: 'messaging',
  http: 'http-traffic',
};

export type JobColumn =
  | 'id'
  | 'type'
  | 'queue'
  | 'status'
  | 'wait'
  | 'duration'
  | 'attempts'
  | 'created'
  | 'source'
  | 'worker'
  | 'priority'
  | 'running'
  | 'progress'
  | 'heartbeat'
  | 'runAt'
  | 'reason'
  | 'error'
  | 'finished'
  | 'cancelled';

/** Cột mặc định theo trạng thái — không hiện mọi cột một lúc. */
export const COLUMNS_OF: Record<StatusFilter, JobColumn[]> = {
  all: ['id', 'type', 'queue', 'status', 'wait', 'duration', 'attempts', 'created'],
  active: ['id', 'type', 'queue', 'status', 'worker', 'running', 'progress', 'attempts'],
  waiting: ['id', 'type', 'queue', 'created', 'wait', 'priority', 'attempts'],
  failed: ['id', 'type', 'queue', 'error', 'attempts', 'duration', 'finished'],
  retrying: ['id', 'type', 'queue', 'error', 'attempts', 'runAt'],
  delayed: ['id', 'type', 'queue', 'runAt', 'reason', 'created'],
  stalled: ['id', 'type', 'queue', 'worker', 'running', 'heartbeat', 'attempts'],
  completed: ['id', 'type', 'queue', 'duration', 'wait', 'finished'],
  cancelled: ['id', 'type', 'queue', 'status', 'cancelled'],
};
/** Cột bật thêm được. */
export const OPTIONAL_COLUMNS: JobColumn[] = ['source', 'worker', 'created', 'priority'];
/** Cột của các bảng job nhỏ (tổng quan, cây job con). */
export const LONG_RUNNING_COLUMNS: JobColumn[] = ['id', 'type', 'worker', 'running', 'progress'];
export const STALLED_COLUMNS: JobColumn[] = ['id', 'type', 'worker', 'running', 'heartbeat'];
export const CHILD_COLUMNS: JobColumn[] = ['id', 'type', 'queue', 'status', 'duration'];

/** Biểu đồ hoạt động job (dùng metric của Worker & Queue). */
export const JOB_METRICS: WorkerMetric[] = ['throughput', 'waiting', 'duration', 'failures', 'retries'];
export const JOB_SERIES_COLOR: Record<string, ChartColor> = {
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

/** KPI tổng quan → bộ lọc Explorer. */
export const KPI_FILTER = {
  waiting: { status: 'waiting' },
  active: { status: 'active' },
  completedToday: { status: 'completed', window: '24h' },
  failedToday: { status: 'failed', window: '24h' },
  retrying: { status: 'retrying' },
  successRate: { status: 'completed', window: '24h' },
} as const;

/** Ngưỡng tô màu. */
export const SUCCESS_RATE_WARN_PERCENT = 95;
export const FAILURE_RATE_WARN_PERCENT = 5;
/** Job ưu tiên cao chờ quá lâu (giây) → cảnh báo. */
export const PRIORITY_WAIT_WARN_SEC = 60;
export const URGENT_PRIORITIES: JobPriorityLevel[] = ['critical', 'high'];

/** Kích thước danh sách. */
export const EXPLORER_PAGE_SIZE = 50;
export const EXPLORER_TABLE_HEIGHT_PX = 620;
export const OVERVIEW_GROUP_LIMIT = 6;
export const TOP_TYPES_LIMIT = 5;
export const BULK_PREVIEW_LIMIT = 10;
export const ACTIVITY_MAX_HEIGHT_PX = 640;
export const JOB_LOGS_MAX_HEIGHT_PX = 420;
export const SHORT_ID_HEAD = 8;
export const SHORT_ID_TAIL = 4;

/** Thao tác. */
export const CANCEL_REASON_MAX = 200;
export const REMOVE_CONFIRM_WORD = 'REMOVE';

/** Khoá cấu hình là mili-giây / giây (định dạng thành thời lượng). */
export const CONFIG_MS_KEYS = new Set(['backoffDelayMs', 'lockDurationMs']);
export const CONFIG_SEC_KEYS = new Set(['longRunningMinSec', 'longWaitMinSec', 'criticalWaitSec']);

/** Thư mục processor của worker (thông tin cho developer trong Job Detail). */
export const HANDLER_SOURCE_PATH = 'backend/src/apps/worker/processors';

import type {
  JobCapability,
  JobDetailTab,
  JobPriorityLevel,
  JobSourceKind,
  JobStatus,
  JobsRange,
  JobsStatusValue,
  JobsTab,
  JobsWindow,
  StatusFilter,
} from '../types/jobs.types';
import type { StatusTone } from '../utils/status-tone';

export const JOBS_TABS: JobsTab[] = ['overview', 'explorer', 'failures', 'performance', 'events', 'configuration'];
export const JOB_DETAIL_TABS: JobDetailTab[] = ['overview', 'lifecycle', 'attempts', 'payload', 'logs', 'configuration'];
export const JOBS_RANGES: JobsRange[] = ['15m', '1h', '6h', '24h'];
export const DEFAULT_JOBS_RANGE: JobsRange = '1h';
export const JOBS_WINDOWS: JobsWindow[] = ['15m', '1h', '6h', '24h', '7d'];
/** Tab trạng thái của Explorer. */
export const STATUS_FILTERS: StatusFilter[] = ['all', 'active', 'waiting', 'failed', 'retrying', 'delayed', 'stalled', 'completed', 'cancelled'];
export const JOB_SOURCES: JobSourceKind[] = ['http', 'scheduler', 'job', 'manual', 'system'];
export const JOB_PRIORITIES: JobPriorityLevel[] = ['critical', 'high', 'normal', 'low'];
/** Tab trạng thái cần capability nào của provider. */
export const STATUS_CAPABILITY: Partial<Record<StatusFilter, JobCapability>> = {
  stalled: 'stalled',
  delayed: 'delayed',
};

export const JOB_STATUS_TONE: Record<JobStatus, StatusTone> = {
  waiting: 'unknown',
  active: 'ok',
  completed: 'ok',
  failed: 'crit',
  retrying: 'warn',
  delayed: 'unknown',
  stalled: 'warn',
  cancelled: 'unknown',
};

/** ○ Waiting · ● Active · ✓ Completed · ✕ Failed · ↻ Retrying · ◷ Delayed · ⚠ Stalled · ⊘ Cancelled. */
export const JOB_STATUS_ICON: Record<JobStatus, string> = {
  waiting: '○',
  active: '●',
  completed: '✓',
  failed: '✕',
  retrying: '↻',
  delayed: '◷',
  stalled: '⚠',
  cancelled: '⊘',
};

export const JOBS_STATUS_TONE: Record<JobsStatusValue, StatusTone> = {
  processing: 'ok',
  idle: 'unknown',
  degraded: 'warn',
  critical: 'crit',
  unavailable: 'crit',
};

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

/** Cột mặc định theo tab trạng thái — không hiện mọi cột một lúc. */
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
/** Cột tuỳ chọn (Source / Worker / Created / Priority). */
export const OPTIONAL_COLUMNS: JobColumn[] = ['source', 'worker', 'created', 'priority'];

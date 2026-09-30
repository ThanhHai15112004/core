import type {
  BackgroundStatus,
  JobState,
  QueueCapability,
  QueueDetailTab,
  QueueStatus,
  WorkerInstanceStatus,
  WorkerMetric,
  WorkerRange,
  WorkerTab,
} from '../types/worker.types';
import type { StatusTone } from '../utils/status-tone';

export const WORKER_TABS: WorkerTab[] = ['overview', 'workers', 'queues', 'failures', 'delayed', 'events', 'configuration'];
export const QUEUE_DETAIL_TABS: QueueDetailTab[] = ['overview', 'jobs', 'workers', 'failures', 'metrics', 'configuration'];
export const WORKER_RANGES: WorkerRange[] = ['15m', '1h', '6h', '24h'];
export const DEFAULT_WORKER_RANGE: WorkerRange = '1h';
export const WORKER_METRICS: WorkerMetric[] = ['throughput', 'waiting', 'duration', 'failures', 'retries'];
/** Trạng thái job hiển thị (provider không hỗ trợ trạng thái nào thì không có job ở trạng thái đó). */
export const JOB_STATES: JobState[] = ['waiting', 'prioritized', 'active', 'delayed', 'retrying', 'completed', 'failed'];

/** Tab cần capability nào (provider không hỗ trợ → "Không hỗ trợ"). */
export const TAB_CAPABILITY: Partial<Record<WorkerTab, QueueCapability>> = {
  delayed: 'delayed',
};

export const BACKGROUND_TONE: Record<BackgroundStatus, StatusTone> = {
  healthy: 'ok',
  degraded: 'warn',
  recovering: 'warn',
  paused: 'unknown',
  down: 'crit',
  unknown: 'unknown',
};

export const QUEUE_STATUS_TONE: Record<QueueStatus, StatusTone> = {
  healthy: 'ok',
  backlog: 'warn',
  high_failure: 'warn',
  slow: 'warn',
  paused: 'unknown',
  no_consumer: 'crit',
  idle: 'unknown',
};

export const QUEUE_STATUS_RANK: Record<QueueStatus, number> = {
  no_consumer: 0,
  high_failure: 1,
  backlog: 2,
  slow: 3,
  paused: 4,
  healthy: 5,
  idle: 6,
};

export const WORKER_STATUS_TONE: Record<WorkerInstanceStatus, StatusTone> = {
  healthy: 'ok',
  busy: 'warn',
  high_memory: 'warn',
  high_cpu: 'warn',
  paused: 'unknown',
};

export const JOB_STATE_TONE: Record<JobState, StatusTone> = {
  waiting: 'unknown',
  prioritized: 'unknown',
  active: 'ok',
  delayed: 'unknown',
  retrying: 'warn',
  completed: 'ok',
  failed: 'crit',
};

/** Ký hiệu trạng thái job (○ chờ, ● chạy, ✓ xong, ✕ lỗi, ↻ retry, ◷ hẹn giờ). */
export const JOB_STATE_ICON: Record<JobState, string> = {
  waiting: '○',
  prioritized: '○',
  active: '●',
  delayed: '◷',
  retrying: '↻',
  completed: '✓',
  failed: '✕',
};

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

/** Từ phải gõ để xác nhận drain. */
export const DRAIN_CONFIRM = 'DRAIN';

import type {
  ExecutionStatus,
  ExecutionTrigger,
  SchedulerMetric,
  SchedulerRange,
  SchedulerStatus,
  SchedulerTab,
  TaskDetailTab,
  TaskDisplayStatus,
  TaskHealth,
} from '../types/scheduler.types';
import type { StatusTone } from '../utils/status-tone';

export const SCHEDULER_TABS: SchedulerTab[] = ['overview', 'tasks', 'history', 'timeline', 'failures', 'events', 'configuration'];
export const TASK_DETAIL_TABS: TaskDetailTab[] = ['overview', 'history', 'metrics', 'logs', 'configuration'];
export const SCHEDULER_RANGES: SchedulerRange[] = ['1h', '6h', '24h', '7d'];
export const DEFAULT_SCHEDULER_RANGE: SchedulerRange = '24h';
export const SCHEDULER_METRICS: SchedulerMetric[] = ['executions', 'duration', 'failures', 'missed'];
export const EXECUTION_STATUSES: ExecutionStatus[] = ['success', 'failed', 'running', 'skipped', 'missed'];
export const EXECUTION_TRIGGERS: ExecutionTrigger[] = ['scheduled', 'manual', 'recovery'];
/** Timeline dạng gantt: 7 ngày quá dày để vẽ từng lần chạy. */
export const TIMELINE_RANGES: SchedulerRange[] = ['1h', '6h', '24h'];

export const SCHEDULER_TONE: Record<SchedulerStatus, StatusTone> = {
  healthy: 'ok',
  degraded: 'warn',
  down: 'crit',
  paused: 'unknown',
  unknown: 'unknown',
};

export const TASK_STATUS_TONE: Record<TaskDisplayStatus, StatusTone> = {
  enabled: 'ok',
  running: 'ok',
  completed: 'unknown',
  disabled: 'unknown',
  failing: 'warn',
  overdue: 'warn',
  misconfigured: 'crit',
};

/** ● Enabled · ○ Disabled · ▶ Running · ⚠ Failing / Overdue · ✕ Misconfigured · ✓ Completed */
export const TASK_STATUS_ICON: Record<TaskDisplayStatus, string> = {
  enabled: '●',
  disabled: '○',
  running: '▶',
  failing: '⚠',
  overdue: '⚠',
  misconfigured: '✕',
  completed: '✓',
};

export const TASK_HEALTH_TONE: Record<TaskHealth, StatusTone> = {
  healthy: 'ok',
  warning: 'warn',
  error: 'crit',
  unknown: 'unknown',
};

export const EXECUTION_TONE: Record<ExecutionStatus, StatusTone> = {
  success: 'ok',
  running: 'ok',
  failed: 'crit',
  skipped: 'unknown',
  missed: 'warn',
};

export const EXECUTION_ICON: Record<ExecutionStatus, string> = {
  success: '✓',
  running: '▶',
  failed: '✕',
  skipped: '↷',
  missed: '⚠',
};

export const SCHEDULER_SERIES_COLORS: Record<string, string> = {
  executions: 'var(--scp-series-1)',
  successful: 'var(--scp-series-4)',
  failed: 'var(--scp-danger)',
  skipped: 'var(--scp-series-3)',
  missed: 'var(--scp-warning)',
  durationAvg: 'var(--scp-series-1)',
  durationP95: 'var(--scp-series-2)',
  driftP95: 'var(--scp-warning)',
};

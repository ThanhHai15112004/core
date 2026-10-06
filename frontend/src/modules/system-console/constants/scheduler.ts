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
export const SCHEDULER_METRICS: SchedulerMetric[] = ['executions', 'duration', 'failures'];
export const EXECUTION_STATUSES: ExecutionStatus[] = ['success', 'failed', 'running', 'scheduled'];
export const EXECUTION_TRIGGERS: ExecutionTrigger[] = ['scheduled', 'manual'];
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
  disabled: 'unknown',
  failing: 'warn',
};

/** ● Enabled · ○ Disabled · ▶ Running · ⚠ Failing */
export const TASK_STATUS_ICON: Record<TaskDisplayStatus, string> = {
  enabled: '●',
  disabled: '○',
  running: '▶',
  failing: '⚠',
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
  scheduled: 'unknown',
};

export const EXECUTION_ICON: Record<ExecutionStatus, string> = {
  success: '✓',
  running: '▶',
  failed: '✕',
  scheduled: '◷',
};

export const SCHEDULER_SERIES_COLORS: Record<string, string> = {
  executions: 'var(--scp-series-1)',
  successful: 'var(--scp-series-4)',
  failed: 'var(--scp-danger)',
  durationAvg: 'var(--scp-series-1)',
};

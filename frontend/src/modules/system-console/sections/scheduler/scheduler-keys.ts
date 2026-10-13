import type { ExecutionFilter } from '../../services/scheduler.api';
import type { SchedulerMetric, SchedulerRange } from '../../types/scheduler.types';

/** Query key của Scheduler — prefix `['scheduler']` để invalidate cả trang sau thao tác. */
export const schedulerKeys = {
  all: ['scheduler'] as const,
  overview: (range: SchedulerRange) => ['scheduler', 'overview', range] as const,
  metrics: (range: SchedulerRange, metric: SchedulerMetric, task: string | null) => ['scheduler', 'metrics', range, metric, task] as const,
  tasks: () => ['scheduler', 'tasks'] as const,
  task: (id: string, range: SchedulerRange) => ['scheduler', 'task', id, range] as const,
  executions: (f: ExecutionFilter) => ['scheduler', 'executions', f] as const,
  execution: (id: string) => ['scheduler', 'execution', id] as const,
  failures: (range: SchedulerRange) => ['scheduler', 'failures', range] as const,
  timeline: (range: SchedulerRange) => ['scheduler', 'timeline', range] as const,
  upcoming: (hours: number) => ['scheduler', 'upcoming', hours] as const,
  operations: () => ['scheduler', 'operations'] as const,
  config: () => ['scheduler', 'config'] as const,
  cron: (expression: string, timezone: string) => ['scheduler', 'cron', expression, timezone] as const,
};

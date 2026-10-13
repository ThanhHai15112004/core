import type { JobFilters, JobsRange } from '../../types/jobs.types';
import type { WorkerMetric } from '../../types/worker.types';

/** Query key của Jobs — prefix `['jobs']` để invalidate cả trang sau thao tác. */
export const jobsKeys = {
  all: ['jobs'] as const,
  overview: (range: JobsRange) => ['jobs', 'overview', range] as const,
  metrics: (range: JobsRange, metric: WorkerMetric, queue: string | null) => ['jobs', 'metrics', range, metric, queue] as const,
  report: (range: JobsRange) => ['jobs', 'report', range] as const,
  failures: (range: JobsRange, queue: string | null) => ['jobs', 'failures', range, queue] as const,
  events: (range: JobsRange) => ['jobs', 'events', range] as const,
  operations: () => ['jobs', 'operations'] as const,
  config: () => ['jobs', 'config'] as const,
  search: (f: JobFilters) => ['jobs', 'search', f] as const,
  job: (id: string, queue: string | null) => ['jobs', 'job', id, queue] as const,
  payload: (id: string, queue: string) => ['jobs', 'payload', id, queue] as const,
};

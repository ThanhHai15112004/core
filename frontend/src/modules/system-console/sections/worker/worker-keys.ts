import type { JobState, WorkerMetric, WorkerRange } from '../../types/worker.types';

/** Query key của Worker & Queue — prefix `['worker']` để invalidate cả trang sau thao tác queue. */
export const workerKeys = {
  all: ['worker'] as const,
  overview: (range: WorkerRange) => ['worker', 'overview', range] as const,
  metrics: (range: WorkerRange, metric: WorkerMetric, queue: string | undefined) => ['worker', 'metrics', range, metric, queue ?? ''] as const,
  queues: (range: WorkerRange) => ['worker', 'queues', range] as const,
  queue: (name: string, range: WorkerRange) => ['worker', 'queue', name, range] as const,
  jobs: (name: string, states: JobState[]) => ['worker', 'jobs', name, states.join(',')] as const,
  workers: () => ['worker', 'workers'] as const,
  worker: (id: string) => ['worker', 'worker', id] as const,
  failures: (range: WorkerRange, queue: string | undefined) => ['worker', 'failures', range, queue ?? ''] as const,
  delayed: () => ['worker', 'delayed'] as const,
  events: (range: WorkerRange) => ['worker', 'events', range] as const,
  operations: () => ['worker', 'operations'] as const,
  config: () => ['worker', 'config'] as const,
};

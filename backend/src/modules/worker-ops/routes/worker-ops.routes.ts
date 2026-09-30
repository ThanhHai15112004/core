/** Worker & Queue: nhìn theo worker (`/ops/workers`) và theo queue (`/ops/queues`). */
export const WORKER_OPS_ROUTES = {
  PREFIX: 'ops/workers',
  OVERVIEW: 'overview',
  METRICS: 'metrics',
  LIST: '',
  DETAIL: ':id',
  FAILURES: 'failures',
  DELAYED: 'delayed',
  EVENTS: 'events',
  OPERATIONS: 'operations',
  CONFIG: 'config',
} as const;

export const QUEUE_OPS_ROUTES = {
  PREFIX: 'ops/queues',
  LIST: '',
  DETAIL: ':name',
  METRICS: ':name/metrics',
  JOBS: ':name/jobs',
  FAILURES: ':name/failures',
  EVENTS: ':name/events',
  PAUSE: ':name/pause',
  RESUME: ':name/resume',
  RETRY_FAILED: ':name/retry-failed',
  DRAIN: ':name/drain',
} as const;

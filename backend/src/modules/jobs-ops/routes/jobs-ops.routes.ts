/** Jobs (Job Explorer + Job Operations): `/ops/jobs/*`. Route tĩnh phải khai báo trước `:id`. */
export const JOBS_OPS_ROUTES = {
  PREFIX: 'ops/jobs',
  OVERVIEW: 'overview',
  SEARCH: '',
  FAILURES: 'failures',
  REPORT: 'report',
  EVENTS: 'events',
  OPERATIONS: 'operations',
  CONFIG: 'config',
  BULK_RETRY: 'retry',
  DETAIL: ':id',
  PAYLOAD: ':id/payload',
  RETRY: ':id/retry',
  CANCEL: ':id/cancel',
  REMOVE: ':id',
} as const;

export const EXPORTS_ROUTES = {
  PREFIX: 'exports',
  HISTORIES: 'histories',
  HISTORY_BY_ID: 'histories/:historyId',
  JOB_PROGRESS: 'jobs/:jobId/progress',
  DOWNLOAD_BY_TOKEN: 'downloads/:token',
  PURGE_EXPIRED: 'purge-expired',
  EXECUTE_BY_PROFILE: ':profileCode',
} as const;

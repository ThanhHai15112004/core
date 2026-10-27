export const IMPORTS_ROUTES = {
  PREFIX: 'imports',
  PROFILES: 'profiles',
  HISTORIES: 'histories',
  HISTORY_BY_ID: 'histories/:historyId',
  JOB_PROGRESS: 'jobs/:jobId/progress',
  TEMPLATE_BY_PROFILE: ':profileCode/template',
  PREVIEW_BY_PROFILE: ':profileCode/preview',
  EXECUTE_BY_PROFILE: ':profileCode',
} as const;

export const REPORTS_ROUTES = {
  PREFIX: 'reports',
  ROOT: '',
  RUN: 'run',
  SCHEDULES: 'schedules',
  SCHEDULE_BY_ID: 'schedules/:scheduleId',
  SCHEDULES_TRIGGER_DUE: 'schedules/trigger-due',
  HISTORIES: 'histories',
  HISTORY_BY_ID: 'histories/:historyId',
  DOWNLOAD_BY_TOKEN: 'downloads/:token',
} as const;

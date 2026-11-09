export const USERS_ROUTES = {
  PREFIX: 'users',
  ROOT: '',
  ME_PREFERENCES: 'me/preferences',
  BY_ID: ':id',
  LOCK: ':id/lock',
  UNLOCK: ':id/unlock',
  DEACTIVATE: ':id/deactivate',
  ACTIVATE: ':id/activate',
  STATUS: ':id/status',
  STATUS_HISTORY: ':id/status-history',
  RESTORE: ':id/restore',
} as const;

export const USERS_ROUTES = {
  PREFIX: 'users',
  ROOT: '',
  EXPORT: 'export',
  IMPORT_TEMPLATE: 'import-template',
  BULK_IMPORT: 'bulk-import',
  BY_ID: ':id',
  LOCK: ':id/lock',
  UNLOCK: ':id/unlock',
  DEACTIVATE: ':id/deactivate',
  ACTIVATE: ':id/activate',
  STATUS: ':id/status',
  STATUS_HISTORY: ':id/status-history',
  RESTORE: ':id/restore',
  RESET_PASSWORD: ':id/reset-password',
  ROLES: ':id/roles',
  ORGANIZATIONS: ':id/organizations',
} as const;


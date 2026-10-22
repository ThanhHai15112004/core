/**
 * Backend API endpoints (relative to `frontendConfig.apiBaseUrl`).
 * Must stay in sync with backend `modules/<module>/routes/*.routes.ts`.
 */
const HEALTH_PREFIX = '/health';
const OPS_PREFIX = '/ops';

export const API_ROUTES = {
  HEALTH: HEALTH_PREFIX,
  OPS: {
    OVERVIEW: `${OPS_PREFIX}/overview`,
    PACKAGES: `${OPS_PREFIX}/packages`,
    EXECUTE_ACTION: (packageId: string, actionId: string) =>
      `${OPS_PREFIX}/packages/${packageId}/actions/${actionId}`,
    SECRETS: `${OPS_PREFIX}/secrets`,
    CONFIGURATION: `${OPS_PREFIX}/configuration`,
    RUNTIMES: {
      LIST: `${OPS_PREFIX}/runtimes`,
      METRICS_ALL: (range: string) => `${OPS_PREFIX}/runtimes/metrics?range=${range}`,
      EVENTS: (limit: number, runtime?: string) =>
        `${OPS_PREFIX}/runtimes/events?limit=${limit}${runtime ? `&runtime=${runtime}` : ''}`,
      COMMAND: (commandId: string) => `${OPS_PREFIX}/runtimes/commands/${commandId}`,
      DETAIL: (id: string) => `${OPS_PREFIX}/runtimes/${id}`,
      METRICS: (id: string, range: string) => `${OPS_PREFIX}/runtimes/${id}/metrics?range=${range}`,
      LOGS: (id: string, limit: number, level?: string) =>
        `${OPS_PREFIX}/runtimes/${id}/logs?limit=${limit}${level ? `&level=${level}` : ''}`,
      ACTION: (id: string, action: 'stop' | 'start') => `${OPS_PREFIX}/runtimes/${id}/${action}`,
    },
    TRAFFIC: {
      SUMMARY: (qs: string) => `${OPS_PREFIX}/traffic/summary?${qs}`,
      TIMESERIES: (qs: string) => `${OPS_PREFIX}/traffic/timeseries?${qs}`,
      ENDPOINTS: (qs: string) => `${OPS_PREFIX}/traffic/endpoints?${qs}`,
      ENDPOINT_DETAIL: (routeId: string, qs: string) => `${OPS_PREFIX}/traffic/endpoints/${encodeURIComponent(routeId)}?${qs}`,
      ERRORS: (qs: string) => `${OPS_PREFIX}/traffic/errors?${qs}`,
      INSIGHTS: (qs: string) => `${OPS_PREFIX}/traffic/insights?${qs}`,
    },
    DATABASE: {
      path: (path: string, qs = '') => `${OPS_PREFIX}/database/${path}${qs ? `?${qs}` : ''}`,
    },
    CACHE: {
      path: (path: string, qs = '') => `${OPS_PREFIX}/cache/${path}${qs ? `?${qs}` : ''}`,
    },
    STORAGE: {
      path: (path: string, qs = '') => `${OPS_PREFIX}/storage/${path}${qs ? `?${qs}` : ''}`,
    },
    MESSAGING: {
      path: (path: string, qs = '') => `${OPS_PREFIX}/messaging/${path}${qs ? `?${qs}` : ''}`,
    },
    WORKERS: {
      path: (path: string, qs = '') => `${OPS_PREFIX}/workers${path ? `/${path}` : ''}${qs ? `?${qs}` : ''}`,
    },
    QUEUES: {
      path: (path: string, qs = '') => `${OPS_PREFIX}/queues${path ? `/${path}` : ''}${qs ? `?${qs}` : ''}`,
    },
    SCHEDULER: {
      path: (path: string, qs = '') => `${OPS_PREFIX}/scheduler/${path}${qs ? `?${qs}` : ''}`,
    },
    JOBS: {
      path: (path: string, qs = '') => `${OPS_PREFIX}/jobs${path ? `/${path}` : ''}${qs ? `?${qs}` : ''}`,
    },
    LOGS_CENTER: {
      path: (path: string, qs = '') => `${OPS_PREFIX}/logs${path ? `/${path}` : ''}${qs ? `?${qs}` : ''}`,
    },
    PERFORMANCE: {
      OVERVIEW: (qs: string) => `${OPS_PREFIX}/performance/overview?${qs}`,
      TIMESERIES: (qs: string) => `${OPS_PREFIX}/performance/timeseries?${qs}`,
      EVENTS: (qs: string) => `${OPS_PREFIX}/performance/events?${qs}`,
      COMPONENT: (id: string, qs: string) => `${OPS_PREFIX}/performance/components/${id}?${qs}`,
    },
  },
  AUTH: {
    LOGIN: '/auth/login',
    MFA_VERIFY: '/auth/mfa/verify',
    MFA_EMAIL_OTP_SEND: '/auth/mfa/email-otp/send',
    MFA_EMAIL_OTP_ENABLE: '/auth/mfa/email-otp/enable',
    MFA_EMAIL_OTP_TOGGLE: '/auth/mfa/email-otp/enable',
    MFA_STATUS: '/auth/mfa/status',
    MFA_TOTP_SETUP: '/auth/mfa/totp/setup',
    MFA_TOTP_ENABLE: '/auth/mfa/totp/enable',
    MFA_TOTP_VERIFY_SETUP: '/auth/mfa/totp/enable',
    MFA_TOTP_DISABLE: '/auth/mfa/disable',
    MFA_DISABLE: '/auth/mfa/disable',
    MFA_RECOVERY_CODES: '/auth/mfa/recovery-codes',
    SECURITY_SETTINGS: '/auth/security-settings',
    REFRESH: '/auth/refresh',
    LOGOUT: '/auth/logout',
    ME: '/auth/me',
    PASSWORD_SUGGEST: (count = 3, length = 16) => `/auth/password/suggest?count=${count}&length=${length}`,
    PASSWORD_CHANGE: '/auth/password/change',
    PASSWORD_FORGOT: '/auth/password/forgot',
    PASSWORD_RESET: '/auth/password/reset',
    PASSWORD_ADMIN_RESET: '/auth/password/admin-reset',
    SESSIONS: '/auth/sessions',
    REVOKE_SESSION: (id: string | number) => `/auth/sessions/${id}`,
    REVOKE_ALL_SESSIONS: '/auth/sessions/revoke-all',
    LOGOUT_ALL: '/auth/logout-all',
    LOGIN_HISTORY: (limit = 50) => `/auth/login-history?limit=${limit}`,
  },
  USERS: {
    LIST: (qs = '') => `/users${qs ? `?${qs}` : ''}`,
    CREATE: '/users',
    DETAIL: (id: string | number) => `/users/${id}`,
    UPDATE: (id: string | number) => `/users/${id}`,
    STATUS_HISTORY: (id: string | number) => `/users/${id}/status-history`,
    LOGIN_HISTORY: (id: string | number) => `/users/${id}/login-history`,
    LOCK: (id: string | number) => `/users/${id}/lock`,
    UNLOCK: (id: string | number) => `/users/${id}/unlock`,
    RESET_PASSWORD: (id: string | number) => `/users/${id}/reset-password`,
    REVOKE_SESSIONS: (id: string | number) => `/users/${id}/revoke-sessions`,
    STATUS: (id: string | number) => `/users/${id}/status`,
    DEACTIVATE: (id: string | number) => `/users/${id}/deactivate`,
    ACTIVATE: (id: string | number) => `/users/${id}/activate`,
    ARCHIVE: (id: string | number) => `/users/${id}`,
    RESTORE: (id: string | number) => `/users/${id}/restore`,
    ASSIGN_ROLES: (id: string | number) => `/users/${id}/roles`,
    ASSIGN_ORGANIZATIONS: (id: string | number) => `/users/${id}/organizations`,
    IMPORT: '/users/bulk-import',
    IMPORT_TEMPLATE: (format: 'csv' | 'xlsx' = 'xlsx') => `/users/import-template?format=${format}`,
    EXPORT: (qs = '') => `/users/export${qs ? `?${qs}` : ''}`,
  },
  ROLES: {
    LIST: '/roles',
    PERMISSIONS: '/roles/permissions',
    PERMISSIONS_GROUPED: '/roles/permissions/grouped',
    PERMISSIONS_SYNC: '/roles/permissions/sync',
    PERMISSIONS_ORPHANS: '/roles/permissions/orphans',
    PERMISSIONS_MATRIX: '/roles/permissions/matrix',
    DATA_SCOPES_ME: '/roles/data-scopes/me',
    DATA_SCOPES_RULES: '/roles/data-scopes/rules',
    AUDIT_LOGS: (qs = '') => `/roles/audit-logs${qs ? `?${qs}` : ''}`,
    AUDIT_LOG_DETAIL: (id: string | number) => `/roles/audit-logs/${id}`,
    DETAIL: (id: string | number) => `/roles/${id}`,
    UPDATE: (id: string | number) => `/roles/${id}`,
    DELETE: (id: string | number) => `/roles/${id}`,
    SET_PERMISSIONS: (id: string | number) => `/roles/${id}/permissions`,
    CLONE: (id: string | number) => `/roles/${id}/clone`,
    USERS: (id: string | number) => `/roles/${id}/users`,
  },
  ORGANIZATIONS: {
    LIST: '/organizations',
    TREE: '/organizations/tree',
    DETAIL: (id: string | number) => `/organizations/${id}`,
  },
  SETTINGS: {
    MENUS: {
      TREE: (position = 'SYSTEM_CONSOLE') => `/settings/menus/tree?position=${encodeURIComponent(position)}`,
      LIST: (qs = '') => `/settings/menus${qs ? `?${qs}` : ''}`,
    },
  },
  FILES: {
    STATS: '/files/stats',
    FOLDERS: (qs = '') => `/files/folders${qs ? `?${qs}` : ''}`,
    FOLDER_BY_ID: (id: string | number) => `/files/folders/${id}`,
    LIST: (qs = '') => `/files${qs ? `?${qs}` : ''}`,
    UPLOAD: '/files/upload',
    UPLOAD_BATCH: '/files/upload-batch',
    TRASH_PURGE_EXPIRED: '/files/trash/purge-expired',
    DETAIL: (id: string | number) => `/files/${id}`,
    UPDATE: (id: string | number) => `/files/${id}`,
    DOWNLOAD: (id: string | number) => `/files/${id}/download`,
    STREAM: (id: string | number) => `/files/${id}/stream`,
    TRASH: (id: string | number) => `/files/${id}/trash`,
    RESTORE: (id: string | number) => `/files/${id}/restore`,
    PURGE: (id: string | number) => `/files/${id}`,
    USAGES: (id: string | number) => `/files/${id}/usages`,
    USAGES_DETACH: (id: string | number) => `/files/${id}/usages/detach`,
    USAGE_BY_ID: (id: string | number, usageId: string | number) =>
      `/files/${id}/usages/${usageId}`,
  },
} as const;


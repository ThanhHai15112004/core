export const AUTH_EVENT_TYPE = {
  LOGIN_SUCCESS: 1,
  LOGIN_FAILED: 2,
  MFA_CHALLENGE: 3,
  MFA_FAILED: 4,
  LOGOUT: 5,
  SESSION_REVOKED: 6,
  SESSION_REVOKE_ALL: 7,
  SESSION_EXPIRED: 8,
  TOKEN_REUSE_DETECTED: 9,
  MFA_DISABLED: 10,
  MFA_RESET: 11,
  PASSWORD_CHANGED: 12,
  PASSWORD_RESET: 13,
  PERMISSION_CHANGED: 14,
  DATA_EXPORT: 15,
} as const;

export const LOGIN_EVENT_TYPE = AUTH_EVENT_TYPE;

export type AuthEventTypeCode = (typeof AUTH_EVENT_TYPE)[keyof typeof AUTH_EVENT_TYPE];
export type AuthEventTypeName = keyof typeof AUTH_EVENT_TYPE;
export type LoginEventTypeCode = AuthEventTypeCode;
export type LoginEventTypeName = AuthEventTypeName;

export const AUTH_EVENT_STATUS = {
  SUCCESS: 1,
  FAILED: 2,
} as const;

export const LOGIN_EVENT_STATUS = AUTH_EVENT_STATUS;

export type AuthEventStatusCode = (typeof AUTH_EVENT_STATUS)[keyof typeof AUTH_EVENT_STATUS];
export type AuthEventStatusName = keyof typeof AUTH_EVENT_STATUS;
export type LoginEventStatusCode = AuthEventStatusCode;
export type LoginEventStatusName = AuthEventStatusName;

export function getAuthEventTypeName(code: number): AuthEventTypeName {
  switch (Number(code)) {
    case AUTH_EVENT_TYPE.LOGIN_FAILED:
      return 'LOGIN_FAILED';
    case AUTH_EVENT_TYPE.MFA_CHALLENGE:
      return 'MFA_CHALLENGE';
    case AUTH_EVENT_TYPE.MFA_FAILED:
      return 'MFA_FAILED';
    case AUTH_EVENT_TYPE.LOGOUT:
      return 'LOGOUT';
    case AUTH_EVENT_TYPE.SESSION_REVOKED:
      return 'SESSION_REVOKED';
    case AUTH_EVENT_TYPE.SESSION_REVOKE_ALL:
      return 'SESSION_REVOKE_ALL';
    case AUTH_EVENT_TYPE.SESSION_EXPIRED:
      return 'SESSION_EXPIRED';
    case AUTH_EVENT_TYPE.TOKEN_REUSE_DETECTED:
      return 'TOKEN_REUSE_DETECTED';
    case AUTH_EVENT_TYPE.MFA_DISABLED:
      return 'MFA_DISABLED';
    case AUTH_EVENT_TYPE.MFA_RESET:
      return 'MFA_RESET';
    case AUTH_EVENT_TYPE.PASSWORD_CHANGED:
      return 'PASSWORD_CHANGED';
    case AUTH_EVENT_TYPE.PASSWORD_RESET:
      return 'PASSWORD_RESET';
    case AUTH_EVENT_TYPE.PERMISSION_CHANGED:
      return 'PERMISSION_CHANGED';
    case AUTH_EVENT_TYPE.DATA_EXPORT:
      return 'DATA_EXPORT';
    case AUTH_EVENT_TYPE.LOGIN_SUCCESS:
    default:
      return 'LOGIN_SUCCESS';
  }
}

export function getAuthEventStatusName(code: number): AuthEventStatusName {
  return Number(code) === AUTH_EVENT_STATUS.FAILED ? 'FAILED' : 'SUCCESS';
}

export const getLoginEventTypeName = getAuthEventTypeName;
export const getLoginEventStatusName = getAuthEventStatusName;

export const AUTH_SESSION_REDIS_PREFIX = 'iam:auth:session:';
export const DEFAULT_ACCESS_TTL_SEC = 900; // 15m
export const DEFAULT_REFRESH_TTL_SEC = 604_800; // 7d
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 30; // 30m
export const DEFAULT_MAX_LIFETIME_MINUTES = 10_080; // 7d

export const TRUSTED_DEVICE_CACHE_PREFIX = 'auth:trusted_device:' as const;

export const SESSIONS_SETTING_KEYS = {
  SESSION_IDLE_TIMEOUT_MINUTES: {
    key: 'security.session.idle_timeout_minutes',
    defaultValue: 30,
  },
  SESSION_MAX_LIFETIME_MINUTES: {
    key: 'security.session.max_lifetime_minutes',
    defaultValue: 10080,
  },
  SESSION_ACCESS_TOKEN_TTL_SECONDS: {
    key: 'security.session.access_token_ttl_seconds',
    defaultValue: 900,
  },
  SESSION_REFRESH_TOKEN_TTL_SECONDS: {
    key: 'security.session.refresh_token_ttl_seconds',
    defaultValue: 604800,
  },
  ENABLE_LOGIN_AUDIT_LOG: {
    key: 'security.audit.enable_login_log',
    defaultValue: true,
  },
} as const;

export const SESSIONS_AUDIT_META = {
  MODULE: 'auth',
} as const;

export const USER_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
  LOCKED: 3,
  ARCHIVED: 4,
} as const;

export type UserStatusCode = (typeof USER_STATUS)[keyof typeof USER_STATUS];
export type UserStatusName = keyof typeof USER_STATUS;

export const USER_GENDER = {
  MALE: 1,
  FEMALE: 2,
  OTHER: 3,
} as const;

export type UserGenderCode = (typeof USER_GENDER)[keyof typeof USER_GENDER];
export type UserGenderName = keyof typeof USER_GENDER;

export const USER_IDENTITY_CACHE_PREFIX = 'iam:user:identity:';

export const USERS_CODE_TYPES = {
  STATUS: 'users.status',
  GENDER: 'users.gender',
  POSITION_TITLE: 'users.position_title',
} as const;

export const USERS_SETTING_KEYS = {
  PAGINATION_PREFIX: 'users.pagination',
  DEFAULT_ROLE_CODE: 'users.default_role_code',
  LOGIN_HISTORY_DEFAULT_LIMIT: 'users.login_history.default_limit',
} as const;

export const USERS_AUDIT_META = {
  MODULE: 'users',
  FEATURES: {
    MANAGEMENT: 'user-management',
    STATUS: 'user-status',
    ROLES: 'user-roles',
    ORGANIZATIONS: 'user-organizations',
    PREFERENCES: 'user-preferences',
  },
  RESOURCE_TYPES: {
    USER: 'user',
    USER_PROFILE: 'user_profile',
  },
} as const;

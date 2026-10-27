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

export const USERS_TAB = {
  DIRECTORY: 'directory',
  LIFECYCLE_SECURITY: 'lifecycle_security',
  BULK_IMPORT_EXPORT: 'bulk_import_export',
  REPORTS_DASHBOARD: 'reports_dashboard',
  GLOBAL_SEARCH: 'global_search',
} as const;

export type UsersTabId = (typeof USERS_TAB)[keyof typeof USERS_TAB];

export const USER_STATUS_META: Record<
  number,
  {
    readonly code: UserStatusCode;
    readonly name: UserStatusName;
    readonly label: string;
    readonly badgeTone: 'success' | 'warning' | 'danger' | 'primary';
  }
> = {
  [USER_STATUS.ACTIVE]: {
    code: USER_STATUS.ACTIVE,
    name: 'ACTIVE',
    label: 'Đang hoạt động (ACTIVE)',
    badgeTone: 'success',
  },
  [USER_STATUS.INACTIVE]: {
    code: USER_STATUS.INACTIVE,
    name: 'INACTIVE',
    label: 'Ngừng hoạt động (INACTIVE)',
    badgeTone: 'warning',
  },
  [USER_STATUS.LOCKED]: {
    code: USER_STATUS.LOCKED,
    name: 'LOCKED',
    label: 'Đang bị khóa (LOCKED)',
    badgeTone: 'danger',
  },
  [USER_STATUS.ARCHIVED]: {
    code: USER_STATUS.ARCHIVED,
    name: 'ARCHIVED',
    label: 'Đã lưu trữ (ARCHIVED)',
    badgeTone: 'primary',
  },
};

export const USER_GENDER_OPTIONS: ReadonlyArray<{
  readonly code: UserGenderCode;
  readonly label: string;
}> = [
  { code: USER_GENDER.MALE, label: 'Nam (Male)' },
  { code: USER_GENDER.FEMALE, label: 'Nữ (Female)' },
  { code: USER_GENDER.OTHER, label: 'Khác (Other)' },
];

export const SUPPORTED_USER_LOCALES = [
  { code: 'vi', label: 'Tiếng Việt (vi)' },
  { code: 'en', label: 'English (en)' },
] as const;

export const COMMON_USER_TIMEZONES = [
  'Asia/Ho_Chi_Minh',
  'UTC',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Europe/London',
  'America/New_York',
] as const;


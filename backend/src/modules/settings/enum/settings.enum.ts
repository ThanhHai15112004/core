export const SETTING_CACHE_TTL_SEC = 300;
export const FEATURE_FLAG_CACHE_TTL_SEC = 300;
export const MENU_TREE_CACHE_PREFIX = 'settings:menus:tree:';
export const MENU_TREE_CACHE_TTL_SEC = 300;
export const MAX_IN_MEMORY_SETTING_HISTORY = 500;

export const SETTINGS_AUDIT_META = {
  MODULE: 'settings',
  FEATURES: {
    SYSTEM_SETTINGS: 'system_settings',
    SETTING_GROUPS: 'setting_groups',
    FEATURE_FLAGS: 'feature_flags',
    I18N_LOCALES: 'i18n_locales',
    I18N_TIMEZONES: 'i18n_timezones',
    I18N_TRANSLATIONS: 'i18n_translations',
    SEQUENCES: 'sequences',
    MENUS: 'menus',
  },
} as const;

export const FEATURE_FLAG_HISTORY_ACTIONS = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  TOGGLE: 'TOGGLE',
  ARCHIVE: 'ARCHIVE',
} as const;

export type FeatureFlagHistoryActionType =
  (typeof FEATURE_FLAG_HISTORY_ACTIONS)[keyof typeof FEATURE_FLAG_HISTORY_ACTIONS];

export const SEQUENCE_HISTORY_ACTIONS = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  RESET_COUNTER: 'RESET_COUNTER',
  ARCHIVE: 'ARCHIVE',
} as const;

export type SequenceHistoryActionType =
  (typeof SEQUENCE_HISTORY_ACTIONS)[keyof typeof SEQUENCE_HISTORY_ACTIONS];

export const MENU_AUDIT_ACTIONS = {
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  TOGGLE: 'TOGGLE',
  REORDER: 'REORDER',
  DELETE: 'DELETE',
} as const;

export type MenuAuditActionType = (typeof MENU_AUDIT_ACTIONS)[keyof typeof MENU_AUDIT_ACTIONS];

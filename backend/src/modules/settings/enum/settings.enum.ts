export const SETTING_CACHE_TTL_SEC = 300;
export const MAX_IN_MEMORY_SETTING_HISTORY = 500;

export const SETTINGS_AUDIT_META = {
  MODULE: 'settings',
  FEATURES: {
    SYSTEM_SETTINGS: 'system_settings',
    SETTING_GROUPS: 'setting_groups',
  },
} as const;

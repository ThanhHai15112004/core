export const FEATURE_FLAG_CACHE_TTL_SEC = 300;
export const MAX_IN_MEMORY_SETTING_HISTORY = 500;

export const FEATURE_FLAGS_AUDIT_META = {
  MODULE: 'feature-flags',
  FEATURES: {
    FEATURE_FLAGS: 'feature_flags',
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

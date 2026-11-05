export const FEATURE_FLAGS_ROUTES = {
  ROOT: 'feature-flags',
  SYNC: 'sync',
  EVALUATE: 'evaluate',
  HISTORY: 'history',
  DETAIL: ':key',
  TOGGLE: ':key/toggle',
  KEY_HISTORY: ':key/history',
} as const;

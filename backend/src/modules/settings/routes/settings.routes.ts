export const SETTINGS_ROUTES = {
  ROOT: 'settings',
  SYNC: 'sync',
  GROUPS: 'groups',
  RESOLVE: 'resolve',
  BULK: 'bulk',
  HISTORY: 'history',
  DETAIL: ':key',
  KEY_SCOPES: ':key/scopes',
  KEY_HISTORY: ':key/history',
} as const;

export const FEATURE_FLAGS_ROUTES = {
  ROOT: 'settings/feature-flags',
  SYNC: 'sync',
  EVALUATE: 'evaluate',
  HISTORY: 'history',
  DETAIL: ':key',
  TOGGLE: ':key/toggle',
  KEY_HISTORY: ':key/history',
} as const;

export const I18N_ROUTES = {
  ROOT: 'settings/i18n',
  SYNC: 'sync',
  LOCALES: 'locales',
  LOCALE_DETAIL: 'locales/:code',
  TIMEZONES: 'timezones',
  TIMEZONE_DETAIL: 'timezones/:code',
  TRANSLATIONS: 'translations',
} as const;

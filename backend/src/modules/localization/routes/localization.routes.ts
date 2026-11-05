export const LOCALIZATION_ROUTES = {
  ROOT: 'localization',
  SYNC: 'sync',
  LOCALES: 'locales',
  LOCALE_DETAIL: 'locales/:code',
  TIMEZONES: 'timezones',
  TIMEZONE_DETAIL: 'timezones/:code',
  TRANSLATIONS: 'translations',
} as const;

export const I18N_ROUTES = LOCALIZATION_ROUTES;

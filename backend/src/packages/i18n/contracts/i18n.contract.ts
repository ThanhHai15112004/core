export type SupportedLocale = 'vi' | 'en';

export interface I18nContract {
  t(key: string, params?: Record<string, string | number>, locale?: SupportedLocale): string;
  getDefaultLocale(): SupportedLocale;
}

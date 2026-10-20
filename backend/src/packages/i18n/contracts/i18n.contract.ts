export type SupportedLocale = 'vi' | 'en' | (string & {});

export const DEFAULT_LOCALE: SupportedLocale = 'vi';
export const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const DEFAULT_CURRENCY = 'VND';
export const DEFAULT_DATE_FORMAT = 'dd/MM/yyyy';
export const DEFAULT_DATETIME_FORMAT = 'dd/MM/yyyy HH:mm:ss';

export const I18N_ITEM_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
} as const;

export type I18nItemStatusCode = (typeof I18N_ITEM_STATUS)[keyof typeof I18N_ITEM_STATUS];

export interface RegisteredLocaleMetadata {
  id?: number;
  code: string;
  bcp47Tag: string;
  name: string;
  nativeName: string;
  direction: 'ltr' | 'rtl';
  dateFormat: string;
  datetimeFormat: string;
  currencyCode: string;
  numberDecimalSeparator: string;
  numberGroupSeparator: string;
  isDefault: boolean;
  isSystem: boolean;
  sortOrder: number;
  status: I18nItemStatusCode;
  updatedBy?: number | null;
  updatedAt?: string;
}

export interface RegisteredTimezoneMetadata {
  id?: number;
  code: string;
  name: string;
  labels: Record<string, string>;
  utcOffset: string;
  utcOffsetMinutes: number;
  region: string;
  isDefault: boolean;
  isSystem: boolean;
  sortOrder: number;
  status: I18nItemStatusCode;
  updatedBy?: number | null;
  updatedAt?: string;
}

export interface RegisteredTranslationItem {
  id?: number;
  locale: string;
  namespace: string;
  key: string;
  value: string;
  description?: string | null;
  isSystem: boolean;
  status: I18nItemStatusCode;
  updatedBy?: number | null;
  updatedAt?: string;
}

export interface I18nContract {
  t(key: string, params?: Record<string, string | number>, locale?: SupportedLocale): string;
  getDefaultLocale(): SupportedLocale;
  getCurrentLocale(): SupportedLocale;
  getDefaultTimezone(): string;
  getCurrentTimezone(): string;
  registerNamespace(
    namespace: string,
    dictionaries: Partial<Record<string, Record<string, string>>>,
  ): void;
}

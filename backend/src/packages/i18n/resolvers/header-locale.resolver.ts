import { defaultSettingRegistry, scanModuleManifests } from '@packages/kernel/index.js';
import {
  DEFAULT_CURRENCY,
  DEFAULT_DATETIME_FORMAT,
  DEFAULT_DATE_FORMAT,
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
  I18N_ITEM_STATUS,
  type I18nItemStatusCode,
  type I18nLocaleManifestItem,
  type I18nTimezoneManifestItem,
  type I18nTranslationManifestItem,
  type RegisteredLocaleMetadata,
  type RegisteredTimezoneMetadata,
  type SupportedLocale,
} from '../contracts/i18n.contract.js';

/**
 * Quét tự động (Zero-Hardcode) các tệp `module.manifest.json` qua hàm dùng chung `scanModuleManifests()`
 * để thu thập danh mục `locales`, `timezones` và `translations` phục vụ Seeder và L1 Fallback (Mục 5.3).
 */
export function discoverManifestI18n(): {
  locales: I18nLocaleManifestItem[];
  timezones: I18nTimezoneManifestItem[];
  translations: I18nTranslationManifestItem[];
} {
  const localeMap = new Map<string, I18nLocaleManifestItem>();
  const timezoneMap = new Map<string, I18nTimezoneManifestItem>();
  const translationMap = new Map<string, I18nTranslationManifestItem>();

  for (const { moduleName, raw } of scanModuleManifests<{
    name?: string;
    locales?: I18nLocaleManifestItem[];
    timezones?: I18nTimezoneManifestItem[];
    translations?: I18nTranslationManifestItem[];
  }>()) {
    if (Array.isArray(raw.locales)) {
      for (const item of raw.locales) {
        if (!item || typeof item.code !== 'string') continue;
        const code = item.code.trim().toLowerCase();
        if (!localeMap.has(code)) {
          localeMap.set(code, { ...item, code });
        }
      }
    }

    if (Array.isArray(raw.timezones)) {
      for (const item of raw.timezones) {
        if (!item || typeof item.code !== 'string') continue;
        const code = item.code.trim();
        if (!timezoneMap.has(code)) {
          timezoneMap.set(code, { ...item, code });
        }
      }
    }

    if (Array.isArray(raw.translations)) {
      for (const item of raw.translations) {
        if (!item || typeof item.locale !== 'string' || typeof item.key !== 'string') continue;
        const locale = item.locale.trim().toLowerCase();
        const key = item.key.trim();
        const namespace = (
          item.namespace ?? (key.includes('.') ? key.split('.')[0]! : moduleName)
        ).trim();
        translationMap.set(`${locale}::${key}`, {
          ...item,
          locale,
          namespace,
          key,
        });
      }
    }
  }

  return {
    locales: [...localeMap.values()],
    timezones: [...timezoneMap.values()],
    translations: [...translationMap.values()],
  };
}

function mapManifestLocale(item: I18nLocaleManifestItem, index: number): RegisteredLocaleMetadata {
  const code = item.code.trim().toLowerCase();
  return {
    id: index + 1,
    code,
    bcp47Tag: item.bcp47Tag?.trim() || (code === 'vi' ? 'vi-VN' : `${code}-${code.toUpperCase()}`),
    name: item.name,
    nativeName: item.nativeName,
    direction: item.direction === 'rtl' ? 'rtl' : 'ltr',
    dateFormat: item.dateFormat || DEFAULT_DATE_FORMAT,
    datetimeFormat: item.datetimeFormat || DEFAULT_DATETIME_FORMAT,
    currencyCode: (item.currencyCode || DEFAULT_CURRENCY).toUpperCase(),
    numberDecimalSeparator: item.numberDecimalSeparator || ',',
    numberGroupSeparator: item.numberGroupSeparator || '.',
    isDefault: Boolean(item.isDefault),
    isSystem: item.isSystem ?? true,
    sortOrder: item.sortOrder ?? index + 1,
    status: (item.status === I18N_ITEM_STATUS.INACTIVE
      ? I18N_ITEM_STATUS.INACTIVE
      : I18N_ITEM_STATUS.ACTIVE) as I18nItemStatusCode,
  };
}

function mapManifestTimezone(
  item: I18nTimezoneManifestItem,
  index: number,
): RegisteredTimezoneMetadata {
  return {
    id: index + 1,
    code: item.code.trim(),
    name: item.name,
    labels: { ...(item.labels ?? { vi: item.name, en: item.name }) },
    utcOffset: item.utcOffset,
    utcOffsetMinutes: item.utcOffsetMinutes,
    region: item.region ?? (item.code.includes('/') ? item.code.split('/')[0]! : 'UTC'),
    isDefault: Boolean(item.isDefault),
    isSystem: item.isSystem ?? true,
    sortOrder: item.sortOrder ?? index + 1,
    status: (item.status === I18N_ITEM_STATUS.INACTIVE
      ? I18N_ITEM_STATUS.INACTIVE
      : I18N_ITEM_STATUS.ACTIVE) as I18nItemStatusCode,
  };
}

const discoveredManifestI18n = discoverManifestI18n();

export const STANDARD_BOOTSTRAP_LOCALES: readonly RegisteredLocaleMetadata[] =
  discoveredManifestI18n.locales.map((item, idx) => mapManifestLocale(item, idx));

export const STANDARD_BOOTSTRAP_TIMEZONES: readonly RegisteredTimezoneMetadata[] =
  discoveredManifestI18n.timezones.map((item, idx) => mapManifestTimezone(item, idx));

/** Bộ nhớ đệm L1 lưu danh mục Ngôn ngữ (Locales) và Múi giờ (Timezones) đồng bộ từ module.manifest.json & Database */
const runtimeLocalesMap = new Map<string, RegisteredLocaleMetadata>(
  STANDARD_BOOTSTRAP_LOCALES.map((item) => [item.code, { ...item }]),
);

const runtimeTimezonesMap = new Map<string, RegisteredTimezoneMetadata>(
  STANDARD_BOOTSTRAP_TIMEZONES.map((item) => [item.code, { ...item }]),
);

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = STANDARD_BOOTSTRAP_LOCALES.map(
  (l) => l.code,
);

/** Lấy danh sách mã ngôn ngữ đang hoạt động (ACTIVE) trong Registry/DB */
export function getActiveSupportedLocales(): SupportedLocale[] {
  const active = [...runtimeLocalesMap.values()]
    .filter((l) => l.status === I18N_ITEM_STATUS.ACTIVE)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((l) => l.code);
  return active.length > 0 ? active : [...SUPPORTED_LOCALES];
}

/** Lấy toàn bộ metadata ngôn ngữ đã đăng ký trong Registry/DB */
export function listRegisteredLocales(includeInactive = false): RegisteredLocaleMetadata[] {
  const list = [...runtimeLocalesMap.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  return includeInactive ? list : list.filter((l) => l.status === I18N_ITEM_STATUS.ACTIVE);
}

/** Lấy metadata của một ngôn ngữ theo mã `code` */
export function getRegisteredLocaleMetadata(
  code?: string | null,
): RegisteredLocaleMetadata | undefined {
  if (!code) return undefined;
  return runtimeLocalesMap.get(code.trim().toLowerCase());
}

/** Lấy mã ngôn ngữ mặc định được đánh dấu `isDefault = true` trong bảng `i18n_locales` */
export function getRegistryDefaultLocaleCode(): SupportedLocale | undefined {
  for (const item of runtimeLocalesMap.values()) {
    if (item.status === I18N_ITEM_STATUS.ACTIVE && item.isDefault) {
      return item.code;
    }
  }
  return undefined;
}

/** Đăng ký hoặc cập nhật động một ngôn ngữ vào Registry (đồng bộ từ bảng `i18n_locales`) */
export function upsertRegisteredLocale(locale: RegisteredLocaleMetadata): RegisteredLocaleMetadata {
  const normalizedCode = locale.code.trim().toLowerCase();
  if (locale.isDefault) {
    for (const [key, existing] of runtimeLocalesMap.entries()) {
      if (key !== normalizedCode && existing.isDefault) {
        runtimeLocalesMap.set(key, { ...existing, isDefault: false });
      }
    }
  }
  const record: RegisteredLocaleMetadata = {
    ...locale,
    code: normalizedCode,
    bcp47Tag: locale.bcp47Tag?.trim() || (normalizedCode === 'vi' ? 'vi-VN' : normalizedCode),
    dateFormat: locale.dateFormat?.trim() || DEFAULT_DATE_FORMAT,
    datetimeFormat: locale.datetimeFormat?.trim() || DEFAULT_DATETIME_FORMAT,
    currencyCode: locale.currencyCode?.trim().toUpperCase() || DEFAULT_CURRENCY,
  };
  runtimeLocalesMap.set(normalizedCode, record);
  return record;
}

/** Khôi phục danh mục ngôn ngữ mặc định (dùng cho test isolation) */
export function resetRegisteredLocales(): void {
  runtimeLocalesMap.clear();
  for (const item of STANDARD_BOOTSTRAP_LOCALES) {
    runtimeLocalesMap.set(item.code, { ...item });
  }
}

/** Lấy toàn bộ danh mục múi giờ đã đăng ký trong Registry/DB */
export function listRegisteredTimezones(includeInactive = false): RegisteredTimezoneMetadata[] {
  const list = [...runtimeTimezonesMap.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  return includeInactive ? list : list.filter((t) => t.status === I18N_ITEM_STATUS.ACTIVE);
}

/** Lấy metadata của một múi giờ theo mã IANA `code` */
export function getRegisteredTimezoneMetadata(
  code?: string | null,
): RegisteredTimezoneMetadata | undefined {
  if (!code) return undefined;
  const trimmed = code.trim();
  const direct = runtimeTimezonesMap.get(trimmed);
  if (direct) return direct;
  const lower = trimmed.toLowerCase();
  for (const item of runtimeTimezonesMap.values()) {
    if (item.code.toLowerCase() === lower) {
      return item;
    }
  }
  return undefined;
}

/** Lấy mã múi giờ mặc định được đánh dấu `isDefault = true` trong bảng `i18n_timezones` */
export function getRegistryDefaultTimezoneCode(): string | undefined {
  for (const item of runtimeTimezonesMap.values()) {
    if (item.status === I18N_ITEM_STATUS.ACTIVE && item.isDefault) {
      return item.code;
    }
  }
  return undefined;
}

/** Đăng ký hoặc cập nhật động một múi giờ vào Registry (đồng bộ từ bảng `i18n_timezones`) */
export function upsertRegisteredTimezone(
  tz: RegisteredTimezoneMetadata,
): RegisteredTimezoneMetadata {
  const normalizedCode = tz.code.trim();
  if (tz.isDefault) {
    for (const [key, existing] of runtimeTimezonesMap.entries()) {
      if (key !== normalizedCode && existing.isDefault) {
        runtimeTimezonesMap.set(key, { ...existing, isDefault: false });
      }
    }
  }
  const record: RegisteredTimezoneMetadata = {
    ...tz,
    code: normalizedCode,
    labels: { ...(tz.labels ?? {}) },
  };
  runtimeTimezonesMap.set(normalizedCode, record);
  return record;
}

/** Khôi phục danh mục múi giờ mặc định (dùng cho test isolation) */
export function resetRegisteredTimezones(): void {
  runtimeTimezonesMap.clear();
  for (const item of STANDARD_BOOTSTRAP_TIMEZONES) {
    runtimeTimezonesMap.set(item.code, { ...item, labels: { ...item.labels } });
  }
}

/** Kiểm tra chuỗi có phải mã ngôn ngữ đang hoạt động (ACTIVE) trong hệ thống hay không */
export function isSupportedLocale(value?: string | null): value is SupportedLocale {
  if (!value || typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  const meta = runtimeLocalesMap.get(normalized);
  if (meta) {
    return meta.status === I18N_ITEM_STATUS.ACTIVE;
  }
  return (SUPPORTED_LOCALES as readonly string[]).includes(normalized);
}

/** Kiểm tra chuỗi có phải múi giờ hợp lệ (đã đăng ký ACTIVE trong DB hoặc múi giờ IANA chuẩn) */
export function isValidIanaTimezone(timezone?: string | null): boolean {
  if (!timezone || typeof timezone !== 'string') return false;
  const trimmed = timezone.trim();
  if (!trimmed) return false;
  const registered = getRegisteredTimezoneMetadata(trimmed);
  if (registered) {
    return registered.status === I18N_ITEM_STATUS.ACTIVE;
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

/** Phân giải múi giờ hợp lệ, fallback về múi giờ mặc định nếu đầu vào không hợp lệ */
export function resolveTimezone(
  timezone?: string | null,
  defaultTimezone: string = getRegistryDefaultTimezoneCode() ?? DEFAULT_TIMEZONE,
): string {
  if (isValidIanaTimezone(timezone)) {
    const reg = getRegisteredTimezoneMetadata(timezone);
    return reg ? reg.code : timezone!.trim();
  }
  return isValidIanaTimezone(defaultTimezone) ? defaultTimezone.trim() : DEFAULT_TIMEZONE;
}

/**
 * Phân giải ngôn ngữ mặc định toàn hệ thống (dùng chung cho CoreI18nService, LocaleFormatter, UsersService):
 * Ưu tiên `ui.locale.default` trong SettingRegistry (nếu khác `'vi'`) -> Ngôn ngữ `isDefault = true` trong `i18n_locales` -> `'vi'`.
 */
export function resolveSystemDefaultLocale(
  fallbackLocale: SupportedLocale = DEFAULT_LOCALE,
): SupportedLocale {
  const configured = defaultSettingRegistry.getString('ui.locale.default');
  const dbDefault = getRegistryDefaultLocaleCode();
  if (
    configured &&
    isSupportedLocale(configured) &&
    (!dbDefault || configured.trim().toLowerCase() !== DEFAULT_LOCALE)
  ) {
    return configured.trim().toLowerCase();
  }
  if (dbDefault && isSupportedLocale(dbDefault)) {
    return dbDefault;
  }
  if (configured && isSupportedLocale(configured)) {
    return configured.trim().toLowerCase();
  }
  return fallbackLocale;
}

/**
 * Phân giải múi giờ mặc định toàn hệ thống (dùng chung cho CoreI18nService, LocaleFormatter, UsersService):
 * Ưu tiên `ui.timezone.default` trong SettingRegistry (nếu khác `'Asia/Ho_Chi_Minh'`) -> Múi giờ `isDefault = true` trong `i18n_timezones` -> `'Asia/Ho_Chi_Minh'`.
 */
export function resolveSystemDefaultTimezone(fallbackTimezone: string = DEFAULT_TIMEZONE): string {
  const configured = defaultSettingRegistry.getString('ui.timezone.default');
  const dbDefault = getRegistryDefaultTimezoneCode();
  if (
    configured &&
    isValidIanaTimezone(configured) &&
    (!dbDefault || configured.trim() !== DEFAULT_TIMEZONE)
  ) {
    return resolveTimezone(configured);
  }
  if (dbDefault && isValidIanaTimezone(dbDefault)) {
    return dbDefault;
  }
  if (configured && isValidIanaTimezone(configured)) {
    return resolveTimezone(configured);
  }
  return fallbackTimezone;
}

/** Lấy locale đầu tiên được hỗ trợ trong header `Accept-Language` (vd. `en-US,en;q=0.9`). */
export function resolveHeaderLocale(
  acceptLanguage?: string,
  defaultLocale: SupportedLocale = getRegistryDefaultLocaleCode() ?? DEFAULT_LOCALE,
): SupportedLocale {
  if (!acceptLanguage) {
    return defaultLocale;
  }

  const activeLocales = getActiveSupportedLocales();
  for (const part of acceptLanguage.split(',')) {
    const rawTag = part.split(';')[0]?.trim().toLowerCase();
    if (!rawTag) continue;
    const directMatch = activeLocales.find((locale) => locale === rawTag);
    if (directMatch) return directMatch;

    const shortCode = rawTag.slice(0, 2);
    const match = activeLocales.find((locale) => locale === shortCode);
    if (match) {
      return match;
    }
  }

  return defaultLocale;
}

/** Phân giải ngôn ngữ từ HTTP headers (`x-locale` hoặc `accept-language`) kèm cờ đánh dấu client gửi tường minh */
export function resolveRequestLocale(
  headers: Record<string, string | string[] | undefined>,
  defaultLocale: SupportedLocale = getRegistryDefaultLocaleCode() ?? DEFAULT_LOCALE,
): { locale: SupportedLocale; explicitLocale: boolean } {
  const rawXLocale = headers['x-locale'];
  const xLocale = Array.isArray(rawXLocale) ? rawXLocale[0] : rawXLocale;
  if (xLocale) {
    const fullCandidate = xLocale.trim().toLowerCase();
    const shortCandidate = fullCandidate.slice(0, 2);
    if (isSupportedLocale(fullCandidate)) {
      return { locale: fullCandidate, explicitLocale: true };
    }
    if (isSupportedLocale(shortCandidate)) {
      return { locale: shortCandidate, explicitLocale: true };
    }
  }

  const rawAccept = headers['accept-language'];
  const acceptLanguage = Array.isArray(rawAccept) ? rawAccept[0] : rawAccept;
  if (acceptLanguage) {
    for (const part of acceptLanguage.split(',')) {
      const rawTag = part.split(';')[0]?.trim().toLowerCase();
      if (!rawTag) continue;
      const lang = rawTag.slice(0, 2);
      if (isSupportedLocale(rawTag)) {
        return { locale: rawTag, explicitLocale: true };
      }
      if (isSupportedLocale(lang)) {
        return { locale: lang, explicitLocale: true };
      }
    }
  }

  return { locale: defaultLocale, explicitLocale: false };
}

/** Phân giải múi giờ từ HTTP header `x-timezone` kèm cờ đánh dấu client gửi tường minh */
export function resolveRequestTimezone(
  headers: Record<string, string | string[] | undefined>,
  defaultTimezone: string = getRegistryDefaultTimezoneCode() ?? DEFAULT_TIMEZONE,
): { timezone: string; explicitTimezone: boolean } {
  const rawTz = headers['x-timezone'];
  const tzHeader = Array.isArray(rawTz) ? rawTz[0] : rawTz;
  if (tzHeader && isValidIanaTimezone(tzHeader)) {
    const reg = getRegisteredTimezoneMetadata(tzHeader);
    return { timezone: reg ? reg.code : tzHeader.trim(), explicitTimezone: true };
  }
  return { timezone: resolveTimezone(defaultTimezone), explicitTimezone: false };
}

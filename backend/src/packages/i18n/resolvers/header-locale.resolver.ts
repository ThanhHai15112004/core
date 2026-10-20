import {
  DEFAULT_CURRENCY,
  DEFAULT_DATETIME_FORMAT,
  DEFAULT_DATE_FORMAT,
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
  I18N_ITEM_STATUS,
  type RegisteredLocaleMetadata,
  type RegisteredTimezoneMetadata,
  type SupportedLocale,
} from '../contracts/i18n.contract.js';

export const STANDARD_BOOTSTRAP_LOCALES: readonly RegisteredLocaleMetadata[] = [
  {
    id: 1,
    code: 'vi',
    bcp47Tag: 'vi-VN',
    name: 'Vietnamese',
    nativeName: 'Tiếng Việt',
    direction: 'ltr',
    dateFormat: 'dd/MM/yyyy',
    datetimeFormat: 'dd/MM/yyyy HH:mm:ss',
    currencyCode: 'VND',
    numberDecimalSeparator: ',',
    numberGroupSeparator: '.',
    isDefault: true,
    isSystem: true,
    sortOrder: 1,
    status: I18N_ITEM_STATUS.ACTIVE,
  },
  {
    id: 2,
    code: 'en',
    bcp47Tag: 'en-US',
    name: 'English',
    nativeName: 'English',
    direction: 'ltr',
    dateFormat: 'MM/dd/yyyy',
    datetimeFormat: 'MM/dd/yyyy HH:mm:ss',
    currencyCode: 'USD',
    numberDecimalSeparator: '.',
    numberGroupSeparator: ',',
    isDefault: false,
    isSystem: true,
    sortOrder: 2,
    status: I18N_ITEM_STATUS.ACTIVE,
  },
];

export const STANDARD_BOOTSTRAP_TIMEZONES: readonly RegisteredTimezoneMetadata[] = [
  {
    id: 1,
    code: 'Asia/Ho_Chi_Minh',
    name: 'Giờ Việt Nam (TP. Hồ Chí Minh / Hà Nội)',
    labels: {
      vi: 'Giờ Việt Nam (UTC+07:00 — TP.HCM / Hà Nội)',
      en: 'Indochina Time (UTC+07:00 — Ho Chi Minh / Hanoi)',
    },
    utcOffset: '+07:00',
    utcOffsetMinutes: 420,
    region: 'Asia',
    isDefault: true,
    isSystem: true,
    sortOrder: 1,
    status: I18N_ITEM_STATUS.ACTIVE,
  },
  {
    id: 2,
    code: 'UTC',
    name: 'Giờ Phối hợp Quốc tế (UTC)',
    labels: {
      vi: 'Giờ Phối hợp Quốc tế (UTC+00:00)',
      en: 'Coordinated Universal Time (UTC+00:00)',
    },
    utcOffset: '+00:00',
    utcOffsetMinutes: 0,
    region: 'UTC',
    isDefault: false,
    isSystem: true,
    sortOrder: 2,
    status: I18N_ITEM_STATUS.ACTIVE,
  },
  {
    id: 3,
    code: 'Asia/Bangkok',
    name: 'Giờ Đông Dương (Bangkok / Jakarta)',
    labels: {
      vi: 'Giờ Bangkok / Jakarta (UTC+07:00)',
      en: 'Bangkok / Jakarta Time (UTC+07:00)',
    },
    utcOffset: '+07:00',
    utcOffsetMinutes: 420,
    region: 'Asia',
    isDefault: false,
    isSystem: true,
    sortOrder: 3,
    status: I18N_ITEM_STATUS.ACTIVE,
  },
  {
    id: 4,
    code: 'Asia/Singapore',
    name: 'Giờ Singapore / Kuala Lumpur',
    labels: {
      vi: 'Giờ Singapore / Kuala Lumpur (UTC+08:00)',
      en: 'Singapore Standard Time (UTC+08:00)',
    },
    utcOffset: '+08:00',
    utcOffsetMinutes: 480,
    region: 'Asia',
    isDefault: false,
    isSystem: true,
    sortOrder: 4,
    status: I18N_ITEM_STATUS.ACTIVE,
  },
  {
    id: 5,
    code: 'Asia/Tokyo',
    name: 'Giờ chuẩn Nhật Bản (Tokyo)',
    labels: {
      vi: 'Giờ Nhật Bản — Tokyo (UTC+09:00)',
      en: 'Japan Standard Time — Tokyo (UTC+09:00)',
    },
    utcOffset: '+09:00',
    utcOffsetMinutes: 540,
    region: 'Asia',
    isDefault: false,
    isSystem: true,
    sortOrder: 5,
    status: I18N_ITEM_STATUS.ACTIVE,
  },
  {
    id: 6,
    code: 'Asia/Seoul',
    name: 'Giờ chuẩn Hàn Quốc (Seoul)',
    labels: {
      vi: 'Giờ Hàn Quốc — Seoul (UTC+09:00)',
      en: 'Korea Standard Time — Seoul (UTC+09:00)',
    },
    utcOffset: '+09:00',
    utcOffsetMinutes: 540,
    region: 'Asia',
    isDefault: false,
    isSystem: true,
    sortOrder: 6,
    status: I18N_ITEM_STATUS.ACTIVE,
  },
  {
    id: 7,
    code: 'Europe/London',
    name: 'Giờ chuẩn Luân Đôn (GMT/BST)',
    labels: {
      vi: 'Giờ Anh Quốc — London (UTC+00:00)',
      en: 'Greenwich Mean Time — London (UTC+00:00)',
    },
    utcOffset: '+00:00',
    utcOffsetMinutes: 0,
    region: 'Europe',
    isDefault: false,
    isSystem: true,
    sortOrder: 7,
    status: I18N_ITEM_STATUS.ACTIVE,
  },
  {
    id: 8,
    code: 'America/New_York',
    name: 'Giờ miền Đông Bắc Mỹ (New York)',
    labels: {
      vi: 'Giờ miền Đông Mỹ — New York (UTC-05:00)',
      en: 'Eastern Time — New York (UTC-05:00)',
    },
    utcOffset: '-05:00',
    utcOffsetMinutes: -300,
    region: 'America',
    isDefault: false,
    isSystem: true,
    sortOrder: 8,
    status: I18N_ITEM_STATUS.ACTIVE,
  },
];

/** Bộ nhớ đệm L1 lưu danh mục Ngôn ngữ (Locales) và Múi giờ (Timezones) đồng bộ từ Database */
const runtimeLocalesMap = new Map<string, RegisteredLocaleMetadata>(
  STANDARD_BOOTSTRAP_LOCALES.map((item) => [item.code, { ...item }]),
);

const runtimeTimezonesMap = new Map<string, RegisteredTimezoneMetadata>(
  STANDARD_BOOTSTRAP_TIMEZONES.map((item) => [item.code, { ...item }]),
);

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ['vi', 'en'];

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

import { vi } from './locales/vi';
import { en } from './locales/en';

export type SupportedLocale = 'vi' | 'en';
export type TranslateParams = Record<string, string | number>;

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ['vi', 'en'];
export const DEFAULT_LOCALE: SupportedLocale = 'vi';
export const DEFAULT_TIMEZONE = 'Asia/Ho_Chi_Minh';
export const LOCALE_STORAGE_KEY = 'scp_locale';
export const TIMEZONE_STORAGE_KEY = 'scp_timezone';

const dictionaries: Record<SupportedLocale, unknown> = { vi, en };

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return SUPPORTED_LOCALES.includes(value as SupportedLocale);
}

export function isValidTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value.trim() });
    return true;
  } catch {
    return false;
  }
}

export function readStoredLocale(): SupportedLocale {
  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isSupportedLocale(saved)) return saved;
  } catch {
    // localStorage bị chặn (private mode...) → dùng mặc định
  }
  return DEFAULT_LOCALE;
}

export function readStoredTimezone(): string {
  try {
    const saved = localStorage.getItem(TIMEZONE_STORAGE_KEY);
    if (isValidTimezone(saved)) return saved.trim();
  } catch {
    // localStorage bị chặn (private mode...) → dùng mặc định
  }
  return DEFAULT_TIMEZONE;
}

/* Locale & Timezone đang dùng, để code ngoài React (vd. fetchApi) đọc được. */
let activeLocale: SupportedLocale = readStoredLocale();
let activeTimezone: string = readStoredTimezone();

export function getActiveLocale(): SupportedLocale {
  return activeLocale;
}

export function setActiveLocale(locale: SupportedLocale): void {
  activeLocale = locale;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
}

export function getActiveTimezone(): string {
  return activeTimezone;
}

export function setActiveTimezone(timezone: string): void {
  if (isValidTimezone(timezone)) {
    activeTimezone = timezone.trim();
  }
}

function resolvePath(target: unknown, path: string): unknown {
  let cur: unknown = target;
  for (const part of path.split('.')) {
    if (cur && typeof cur === 'object' && part in cur) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Tra `path` (vd. `overview.title`) trong từ điển; thiếu thì fallback `en`, cuối cùng trả về chính `path`. */
export function translate(locale: SupportedLocale, path: string, params?: TranslateParams): string {
  let result = resolvePath(dictionaries[locale], path);
  if (typeof result !== 'string') result = resolvePath(dictionaries.en, path);
  if (typeof result !== 'string') return path;

  if (!params) return result;
  return Object.entries(params).reduce(
    (acc, [key, val]) => acc.replaceAll(`{{${key}}}`, String(val)).replaceAll(`{${key}}`, String(val)),
    result,
  );
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
];

/** "5 phút trước" / "5 minutes ago" theo locale. */
export function formatRelative(value: Date | string | number, locale: SupportedLocale, now = Date.now()): string {
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size || unit === 'second') {
      return rtf.format(Math.round(seconds / size), unit);
    }
  }
  return rtf.format(0, 'second');
}

/** Format thời gian theo locale và múi giờ đang chọn. */
export function formatTime(
  value: Date | string | number,
  locale: SupportedLocale,
  withSeconds = true,
  timeZone: string = activeTimezone,
): string {
  const validTz = isValidTimezone(timeZone) ? timeZone.trim() : DEFAULT_TIMEZONE;
  return new Date(value).toLocaleTimeString(locale === 'vi' ? 'vi-VN' : 'en-US', {
    timeZone: validTz,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  });
}

import { defaultSettingRegistry } from '@packages/kernel/index.js';
import { LocaleContext } from '../context/locale-context.js';
import {
  DEFAULT_CURRENCY,
  DEFAULT_DATETIME_FORMAT,
  DEFAULT_DATE_FORMAT,
  type SupportedLocale,
} from '../contracts/i18n.contract.js';
import {
  getRegisteredLocaleMetadata,
  isSupportedLocale,
  isValidIanaTimezone,
  resolveSystemDefaultLocale,
  resolveSystemDefaultTimezone,
  resolveTimezone,
} from '../resolvers/header-locale.resolver.js';

export interface FormatDateTimeOptions {
  locale?: SupportedLocale;
  timeZone?: string;
  dateStyle?: 'full' | 'long' | 'medium' | 'short';
  timeStyle?: 'full' | 'long' | 'medium' | 'short';
}

export class LocaleFormatter {
  /** Lấy tag BCP-47 chuẩn từ metadata ngôn ngữ trong DB (`i18n_locales.bcp47_tag`) */
  public static toBcp47Tag(locale?: SupportedLocale): string {
    const resolved = LocaleFormatter.resolveActiveLocale(locale);
    const meta = getRegisteredLocaleMetadata(resolved);
    if (meta?.bcp47Tag) {
      return meta.bcp47Tag;
    }
    return resolved === 'vi' ? 'vi-VN' : resolved === 'en' ? 'en-US' : resolved;
  }

  /** Phân giải locale hiệu lực từ tham số -> LocaleContext -> DB Default Locale / System Setting -> `'vi'` */
  public static resolveActiveLocale(locale?: SupportedLocale): SupportedLocale {
    if (locale && isSupportedLocale(locale)) return locale.trim().toLowerCase();
    const ctxLocale = LocaleContext.get();
    if (ctxLocale && isSupportedLocale(ctxLocale)) return ctxLocale.trim().toLowerCase();
    return resolveSystemDefaultLocale();
  }

  /** Phân giải múi giờ hiệu lực từ tham số -> LocaleContext -> DB Default Timezone / System Setting -> `'Asia/Ho_Chi_Minh'` */
  public static resolveActiveTimezone(timeZone?: string | null): string {
    if (timeZone && isValidIanaTimezone(timeZone)) return resolveTimezone(timeZone);
    const ctxTz = LocaleContext.getTimezone();
    if (ctxTz && isValidIanaTimezone(ctxTz)) return resolveTimezone(ctxTz);
    return resolveSystemDefaultTimezone();
  }

  /** Phân giải đơn vị tiền tệ hiệu lực từ tham số -> System Setting (`ui.currency.default`) -> DB Locale (`i18n_locales.currency_code`) */
  public static resolveActiveCurrency(currencyCode?: string, locale?: SupportedLocale): string {
    if (currencyCode && currencyCode.trim().length > 0) {
      return currencyCode.trim().toUpperCase();
    }
    const resolvedLocale = LocaleFormatter.resolveActiveLocale(locale);
    const configured = defaultSettingRegistry.getString('ui.currency.default');
    if (configured && configured.trim().length > 0 && (!locale || resolvedLocale === 'vi')) {
      return configured.trim().toUpperCase();
    }
    const meta = getRegisteredLocaleMetadata(resolvedLocale);
    if (meta?.currencyCode) {
      return meta.currencyCode.toUpperCase();
    }
    return resolvedLocale === 'vi' ? DEFAULT_CURRENCY : 'USD';
  }

  /** Định dạng số (Number) chuẩn theo locale trong DB */
  public static formatNumber(
    value: number,
    locale?: SupportedLocale,
    options?: Intl.NumberFormatOptions,
  ): string {
    if (!Number.isFinite(value)) return '0';
    return new Intl.NumberFormat(LocaleFormatter.toBcp47Tag(locale), options).format(value);
  }

  /** Định dạng tỷ lệ phần trăm chuẩn theo locale */
  public static formatPercent(
    value: number,
    locale?: SupportedLocale,
    maximumFractionDigits = 1,
  ): string {
    if (!Number.isFinite(value)) return '0%';
    return new Intl.NumberFormat(LocaleFormatter.toBcp47Tag(locale), {
      style: 'percent',
      minimumFractionDigits: 0,
      maximumFractionDigits,
    }).format(value / 100);
  }

  /** Định dạng giá trị tiền tệ theo locale và đơn vị tiền tệ chuẩn (5.3.6) */
  public static formatCurrency(
    amount: number,
    locale?: SupportedLocale,
    currencyCode?: string,
  ): string {
    const resolvedLocale = LocaleFormatter.resolveActiveLocale(locale);
    const currency = LocaleFormatter.resolveActiveCurrency(currencyCode, locale);
    return new Intl.NumberFormat(LocaleFormatter.toBcp47Tag(resolvedLocale), {
      style: 'currency',
      currency,
    }).format(Number.isFinite(amount) ? amount : 0);
  }

  /** Định dạng ngày giờ theo locale và múi giờ người dùng (5.3.4, 5.3.5, 5.3.6) */
  public static formatDate(
    dateInput: Date | string | number,
    locale?: SupportedLocale,
    timeZone?: string,
  ): string {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(date.getTime())) return '';
    const resolvedLocale = LocaleFormatter.resolveActiveLocale(locale);
    const resolvedTz = LocaleFormatter.resolveActiveTimezone(timeZone);
    return new Intl.DateTimeFormat(LocaleFormatter.toBcp47Tag(resolvedLocale), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: resolvedTz,
    }).format(date);
  }

  /** Định dạng chỉ ngày (không kèm giờ) theo locale và múi giờ người dùng */
  public static formatDateOnly(
    dateInput: Date | string | number,
    locale?: SupportedLocale,
    timeZone?: string,
  ): string {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(date.getTime())) return '';
    const resolvedLocale = LocaleFormatter.resolveActiveLocale(locale);
    const resolvedTz = LocaleFormatter.resolveActiveTimezone(timeZone);
    return new Intl.DateTimeFormat(LocaleFormatter.toBcp47Tag(resolvedLocale), {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: resolvedTz,
    }).format(date);
  }

  /**
   * Trích xuất các thành phần ngày/giờ của một mốc thời gian UTC khi chiếu sang múi giờ `timeZone`.
   * Dùng chung cho báo cáo Excel/CSV, lịch biểu mà không hard-code phép cộng trừ giờ thủ công.
   */
  public static extractPartsInTimezone(
    dateInput: Date | string | number,
    timeZone?: string,
  ): {
    year: string;
    month: string;
    day: string;
    hour: string;
    minute: string;
    second: string;
  } | null {
    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(date.getTime())) return null;
    const resolvedTz = resolveTimezone(LocaleFormatter.resolveActiveTimezone(timeZone));
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: resolvedTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const lookup = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((p) => p.type === type)?.value ?? '00';

    const rawHour = lookup('hour');
    const normalizedHour = rawHour === '24' ? '00' : rawHour;

    return {
      year: lookup('year'),
      month: lookup('month'),
      day: lookup('day'),
      hour: normalizedHour,
      minute: lookup('minute'),
      second: lookup('second'),
    };
  }

  /** Áp dụng mẫu định dạng động (`dd/MM/yyyy`, `yyyy-MM-dd`, `MM/dd/yyyy HH:mm:ss`...) từ cấu hình ngôn ngữ trong DB */
  public static applyDatePattern(
    parts: {
      year: string;
      month: string;
      day: string;
      hour: string;
      minute: string;
      second: string;
    },
    pattern: string,
  ): string {
    return pattern
      .replaceAll('yyyy', parts.year)
      .replaceAll('YYYY', parts.year)
      .replaceAll('MM', parts.month)
      .replaceAll('dd', parts.day)
      .replaceAll('DD', parts.day)
      .replaceAll('HH', parts.hour)
      .replaceAll('mm', parts.minute)
      .replaceAll('ss', parts.second);
  }

  /**
   * Định dạng ngày giờ báo cáo theo mẫu `datetimeFormat` cấu hình trong DB (mặc định `dd/MM/yyyy HH:mm:ss`)
   * và theo múi giờ người dùng chọn.
   */
  public static formatReportDateTime(
    dateInput: Date | string | number = new Date(),
    timeZone?: string,
    locale?: SupportedLocale,
  ): string {
    const parts = LocaleFormatter.extractPartsInTimezone(dateInput, timeZone);
    if (!parts) return '';
    const meta = locale ? getRegisteredLocaleMetadata(locale) : undefined;
    const pattern = meta?.datetimeFormat || DEFAULT_DATETIME_FORMAT;
    return LocaleFormatter.applyDatePattern(parts, pattern);
  }

  /**
   * Định dạng ngày ngắn báo cáo theo mẫu `dateFormat` cấu hình trong DB (mặc định `dd/MM/yyyy`)
   * và theo múi giờ người dùng chọn.
   */
  public static formatReportDateOnly(
    dateInput?: Date | string | number | null,
    timeZone?: string,
    locale?: SupportedLocale,
  ): string {
    if (dateInput === undefined || dateInput === null || dateInput === '') return '';
    const parts = LocaleFormatter.extractPartsInTimezone(dateInput, timeZone);
    if (!parts) return '';
    const meta = locale ? getRegisteredLocaleMetadata(locale) : undefined;
    const pattern = meta?.dateFormat || DEFAULT_DATE_FORMAT;
    return LocaleFormatter.applyDatePattern(parts, pattern);
  }
}

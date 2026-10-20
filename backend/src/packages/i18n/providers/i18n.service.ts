import { Injectable } from '@nestjs/common';
import { defaultSettingRegistry } from '@packages/kernel/index.js';
import {
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
  type I18nContract,
  type SupportedLocale,
} from '../contracts/i18n.contract.js';
import { LocaleContext } from '../context/locale-context.js';
import {
  getActiveSupportedLocales,
  getRegistryDefaultLocaleCode,
  getRegistryDefaultTimezoneCode,
  isSupportedLocale,
  isValidIanaTimezone,
} from '../resolvers/header-locale.resolver.js';
import enCommon from '../locales/en/common.json' with { type: 'json' };
import viCommon from '../locales/vi/common.json' with { type: 'json' };
import enOps from '../locales/en/ops.json' with { type: 'json' };
import viOps from '../locales/vi/ops.json' with { type: 'json' };
import enOverview from '../locales/en/overview.json' with { type: 'json' };
import viOverview from '../locales/vi/overview.json' with { type: 'json' };
import enRuntime from '../locales/en/runtime.json' with { type: 'json' };
import viRuntime from '../locales/vi/runtime.json' with { type: 'json' };
import enTraffic from '../locales/en/traffic.json' with { type: 'json' };
import viTraffic from '../locales/vi/traffic.json' with { type: 'json' };
import enPerformance from '../locales/en/performance.json' with { type: 'json' };
import viPerformance from '../locales/vi/performance.json' with { type: 'json' };
import enDatabase from '../locales/en/database.json' with { type: 'json' };
import viDatabase from '../locales/vi/database.json' with { type: 'json' };
import enCache from '../locales/en/cache.json' with { type: 'json' };
import viCache from '../locales/vi/cache.json' with { type: 'json' };
import enStorage from '../locales/en/storage.json' with { type: 'json' };
import viStorage from '../locales/vi/storage.json' with { type: 'json' };
import enMessaging from '../locales/en/messaging.json' with { type: 'json' };
import viMessaging from '../locales/vi/messaging.json' with { type: 'json' };
import enWorker from '../locales/en/worker.json' with { type: 'json' };
import viWorker from '../locales/vi/worker.json' with { type: 'json' };
import enScheduler from '../locales/en/scheduler.json' with { type: 'json' };
import viScheduler from '../locales/vi/scheduler.json' with { type: 'json' };
import enJobs from '../locales/en/jobs.json' with { type: 'json' };
import viJobs from '../locales/vi/jobs.json' with { type: 'json' };
import enLogs from '../locales/en/logs.json' with { type: 'json' };
import viLogs from '../locales/vi/logs.json' with { type: 'json' };

type Dictionary = Record<string, string>;

const INITIAL_STATIC_DICTIONARIES: Record<string, Dictionary> = {
  en: {
    ...enCommon,
    ...enOps,
    ...enOverview,
    ...enRuntime,
    ...enTraffic,
    ...enPerformance,
    ...enDatabase,
    ...enCache,
    ...enStorage,
    ...enMessaging,
    ...enWorker,
    ...enScheduler,
    ...enJobs,
    ...enLogs,
  },
  vi: {
    ...viCommon,
    ...viOps,
    ...viOverview,
    ...viRuntime,
    ...viTraffic,
    ...viPerformance,
    ...viDatabase,
    ...viCache,
    ...viStorage,
    ...viMessaging,
    ...viWorker,
    ...viScheduler,
    ...viJobs,
    ...viLogs,
  },
};

/** Bộ từ điển toàn cục chia sẻ giữa các instance CoreI18nService và đồng bộ từ bảng `i18n_translations` */
const sharedDictionaries: Record<string, Dictionary> = {
  en: { ...INITIAL_STATIC_DICTIONARIES['en'] },
  vi: { ...INITIAL_STATIC_DICTIONARIES['vi'] },
};

/** Lấy bản sao từ điển tĩnh khởi tạo theo từng ngôn ngữ (dùng để seed/sync vào bảng `i18n_translations`) */
export function getInitialStaticDictionaries(): Record<string, Record<string, string>> {
  return {
    vi: { ...INITIAL_STATIC_DICTIONARIES['vi'] },
    en: { ...INITIAL_STATIC_DICTIONARIES['en'] },
  };
}

/** Ghi đè hoặc thêm mới 1 bản dịch động từ Database (`i18n_translations`) vào bộ nhớ runtime */
export function setRuntimeTranslation(locale: string, key: string, value: string): void {
  const normLocale = locale.trim().toLowerCase();
  if (!sharedDictionaries[normLocale]) {
    sharedDictionaries[normLocale] = {};
  }
  sharedDictionaries[normLocale][key.trim()] = value;
}

/** Xóa 1 bản dịch động khỏi bộ nhớ runtime (hoặc khôi phục về giá trị tĩnh gốc nếu có) */
export function removeRuntimeTranslation(locale: string, key: string): void {
  const normLocale = locale.trim().toLowerCase();
  const cleanKey = key.trim();
  const staticVal = INITIAL_STATIC_DICTIONARIES[normLocale]?.[cleanKey];
  if (staticVal !== undefined) {
    sharedDictionaries[normLocale]![cleanKey] = staticVal;
  } else {
    delete sharedDictionaries[normLocale]?.[cleanKey];
  }
}

@Injectable()
export class CoreI18nService implements I18nContract {
  private readonly defaultLocale: SupportedLocale = 'vi';
  private readonly dictionaries: Record<string, Dictionary> = sharedDictionaries;

  /**
   * Lấy mã ngôn ngữ mặc định được cấu hình trong hệ thống:
   * Ưu tiên `ui.locale.default` (nếu khác `'vi'`) -> Ngôn ngữ `isDefault = true` trong bảng `i18n_locales` -> `'vi'`.
   */
  public getDefaultLocale(): SupportedLocale {
    const configured = defaultSettingRegistry.getValue<string>('ui.locale.default');
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
    if (isSupportedLocale(configured)) {
      return configured.trim().toLowerCase();
    }
    return this.defaultLocale ?? DEFAULT_LOCALE;
  }

  /** Locale của request hiện tại, fallback về locale mặc định khi chạy ngoài HTTP. */
  public getCurrentLocale(): SupportedLocale {
    return LocaleContext.get() ?? this.getDefaultLocale();
  }

  /**
   * Lấy múi giờ mặc định được cấu hình trong hệ thống:
   * Ưu tiên `ui.timezone.default` (nếu khác `'Asia/Ho_Chi_Minh'`) -> Múi giờ `isDefault = true` trong bảng `i18n_timezones` -> `'Asia/Ho_Chi_Minh'`.
   */
  public getDefaultTimezone(): string {
    const configured = defaultSettingRegistry.getValue<string>('ui.timezone.default');
    const dbDefault = getRegistryDefaultTimezoneCode();
    if (
      configured &&
      isValidIanaTimezone(configured) &&
      (!dbDefault || configured.trim() !== DEFAULT_TIMEZONE)
    ) {
      return configured.trim();
    }
    if (dbDefault && isValidIanaTimezone(dbDefault)) {
      return dbDefault;
    }
    if (isValidIanaTimezone(configured)) {
      return configured!.trim();
    }
    return DEFAULT_TIMEZONE;
  }

  /** Múi giờ của request hiện tại, fallback về múi giờ mặc định khi chạy ngoài HTTP. */
  public getCurrentTimezone(): string {
    return LocaleContext.getTimezone() ?? this.getDefaultTimezone();
  }

  /** Đăng ký từ điển ngôn ngữ của module nghiệp vụ theo namespace (vd: 'roles' -> 'roles.notFound') */
  public registerNamespace(
    namespace: string,
    dictionaries: Partial<Record<string, Record<string, string>>>,
  ): void {
    const cleanNs = namespace.trim();
    const locales = new Set<string>([...getActiveSupportedLocales(), ...Object.keys(dictionaries)]);
    for (const rawLocale of locales) {
      const locale = rawLocale.trim().toLowerCase();
      const entries = dictionaries[rawLocale] ?? dictionaries[locale];
      if (!entries) continue;
      if (!this.dictionaries[locale]) {
        this.dictionaries[locale] = {};
      }
      for (const [k, v] of Object.entries(entries)) {
        const prefixedKey = cleanNs && !k.startsWith(`${cleanNs}.`) ? `${cleanNs}.${k}` : k;
        this.dictionaries[locale][prefixedKey] = v;
        if (!(k in this.dictionaries[locale])) {
          this.dictionaries[locale][k] = v;
        }
      }
    }
  }

  /** Upsert trực tiếp một câu dịch vào từ điển runtime */
  public upsertTranslation(locale: string, key: string, value: string, namespace?: string): void {
    const normLocale = locale.trim().toLowerCase();
    const cleanKey = key.trim();
    setRuntimeTranslation(normLocale, cleanKey, value);
    if (namespace && namespace.trim().length > 0) {
      const cleanNs = namespace.trim();
      const prefixed = !cleanKey.startsWith(`${cleanNs}.`) ? `${cleanNs}.${cleanKey}` : cleanKey;
      setRuntimeTranslation(normLocale, prefixed, value);
    }
  }

  /** Lấy toàn bộ bản dịch đang nạp trong bộ nhớ của một ngôn ngữ */
  public getDictionary(locale: string): Record<string, string> {
    return { ...(this.dictionaries[locale.trim().toLowerCase()] ?? {}) };
  }

  /** Dịch `key`; không tìm thấy thì thử locale mặc định rồi trả về chính `key`. Hỗ trợ cả `{param}` và `{{param}}`. */
  public t(
    key: string,
    params?: Record<string, string | number>,
    locale: SupportedLocale = this.getCurrentLocale(),
  ): string {
    const normLocale = locale.trim().toLowerCase();
    const fallbackLocale = this.getDefaultLocale();
    let message =
      this.dictionaries[normLocale]?.[key] ??
      this.dictionaries[fallbackLocale]?.[key] ??
      this.dictionaries[this.defaultLocale]?.[key] ??
      key;

    if (params) {
      for (const [paramKey, paramVal] of Object.entries(params)) {
        const strVal = String(paramVal);
        message = message.replaceAll(`{{${paramKey}}}`, strVal).replaceAll(`{${paramKey}}`, strVal);
      }
    }

    return message;
  }
}

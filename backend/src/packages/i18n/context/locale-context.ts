import { AsyncLocalStorage } from 'node:async_hooks';
import { DEFAULT_TIMEZONE, type SupportedLocale } from '../contracts/i18n.contract.js';
import { isSupportedLocale, isValidIanaTimezone } from '../resolvers/header-locale.resolver.js';

export interface LocaleContextState {
  locale: SupportedLocale;
  timezone: string;
  explicitLocale: boolean;
  explicitTimezone: boolean;
}

export interface LocaleRunOptions {
  timezone?: string;
  explicitLocale?: boolean;
  explicitTimezone?: boolean;
}

const storage = new AsyncLocalStorage<LocaleContextState>();

/** Ngữ cảnh đa ngôn ngữ (Locale) và múi giờ (Timezone) của request hiện tại. */
export const LocaleContext = {
  /** Thực thi callback trong ngữ cảnh locale & timezone chỉ định */
  run<R>(locale: SupportedLocale, callback: () => R, options?: LocaleRunOptions): R {
    const timezone =
      options?.timezone && isValidIanaTimezone(options.timezone)
        ? options.timezone.trim()
        : DEFAULT_TIMEZONE;
    const state: LocaleContextState = {
      locale,
      timezone,
      explicitLocale: options?.explicitLocale ?? false,
      explicitTimezone: options?.explicitTimezone ?? false,
    };
    return storage.run(state, callback);
  },

  /** Lấy mã ngôn ngữ (`vi` | `en`) của request hiện tại */
  get(): SupportedLocale | undefined {
    return storage.getStore()?.locale;
  },

  /** Lấy múi giờ IANA (ví dụ: `Asia/Ho_Chi_Minh`, `UTC`) của request hiện tại */
  getTimezone(): string | undefined {
    return storage.getStore()?.timezone;
  },

  /** Lấy toàn bộ trạng thái ngữ cảnh locale & timezone hiện tại */
  getState(): LocaleContextState | undefined {
    return storage.getStore();
  },

  /** Cập nhật ngôn ngữ cho request hiện tại */
  setLocale(locale: SupportedLocale, explicit = false): void {
    const store = storage.getStore();
    if (store && isSupportedLocale(locale)) {
      store.locale = locale;
      if (explicit) {
        store.explicitLocale = true;
      }
    }
  },

  /** Cập nhật múi giờ cho request hiện tại */
  setTimezone(timezone: string, explicit = false): void {
    const store = storage.getStore();
    if (store && isValidIanaTimezone(timezone)) {
      store.timezone = timezone.trim();
      if (explicit) {
        store.explicitTimezone = true;
      }
    }
  },

  /**
   * Áp dụng tùy chọn ngôn ngữ & múi giờ đã lưu trong hồ sơ người dùng (preference)
   * nếu request hiện tại không truyền header ép buộc tường minh.
   */
  applyUserPreferences(preferences?: {
    preferredLocale?: string | null;
    preferredTimezone?: string | null;
  }): void {
    const store = storage.getStore();
    if (!store || !preferences) return;

    if (!store.explicitLocale && isSupportedLocale(preferences.preferredLocale)) {
      store.locale = preferences.preferredLocale.trim().toLowerCase() as SupportedLocale;
    }

    if (!store.explicitTimezone && isValidIanaTimezone(preferences.preferredTimezone)) {
      store.timezone = preferences.preferredTimezone!.trim();
    }
  },
};

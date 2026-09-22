import { Injectable } from '@nestjs/common';
import type { I18nContract, SupportedLocale } from '../contracts/i18n.contract.js';
import { LocaleContext } from '../context/locale-context.js';
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

type Dictionary = Record<string, string>;

@Injectable()
export class CoreI18nService implements I18nContract {
  private readonly defaultLocale: SupportedLocale = 'vi';
  private readonly dictionaries: Record<SupportedLocale, Dictionary> = {
    en: {
      ...enCommon,
      ...enOps,
      ...enOverview,
      ...enRuntime,
      ...enTraffic,
      ...enPerformance,
      ...enDatabase,
      ...enCache,
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
    },
  };

  public getDefaultLocale(): SupportedLocale {
    return this.defaultLocale;
  }

  /** Locale của request hiện tại, fallback về locale mặc định khi chạy ngoài HTTP. */
  public getCurrentLocale(): SupportedLocale {
    return LocaleContext.get() ?? this.defaultLocale;
  }

  /** Dịch `key`; không tìm thấy thì thử locale mặc định rồi trả về chính `key`. */
  public t(
    key: string,
    params?: Record<string, string | number>,
    locale: SupportedLocale = this.getCurrentLocale(),
  ): string {
    let message =
      this.dictionaries[locale]?.[key] ?? this.dictionaries[this.defaultLocale][key] ?? key;

    if (params) {
      for (const [paramKey, paramVal] of Object.entries(params)) {
        message = message.replaceAll(`{${paramKey}}`, String(paramVal));
      }
    }

    return message;
  }
}

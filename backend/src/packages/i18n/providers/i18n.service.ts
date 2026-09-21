import { Injectable } from '@nestjs/common';
import type { I18nContract, SupportedLocale } from '../contracts/i18n.contract.js';
import enCommon from '../locales/en/common.json' with { type: 'json' };
import viCommon from '../locales/vi/common.json' with { type: 'json' };

@Injectable()
export class CoreI18nService implements I18nContract {
  private readonly defaultLocale: SupportedLocale = 'vi';
  private readonly dictionaries: Record<SupportedLocale, Record<string, string>> = {
    en: enCommon as Record<string, string>,
    vi: viCommon as Record<string, string>,
  };

  public getDefaultLocale(): SupportedLocale {
    return this.defaultLocale;
  }

  public t(
    key: string,
    params?: Record<string, string | number>,
    locale: SupportedLocale = this.defaultLocale,
  ): string {
    const dict = this.dictionaries[locale] || this.dictionaries[this.defaultLocale];
    let message = dict[key] ?? key;

    if (params) {
      for (const [paramKey, paramVal] of Object.entries(params)) {
        message = message.replaceAll(`{${paramKey}}`, String(paramVal));
      }
    }

    return message;
  }
}

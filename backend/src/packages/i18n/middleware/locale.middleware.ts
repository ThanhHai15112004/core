import { Injectable, type NestMiddleware } from '@nestjs/common';
import { defaultSettingRegistry } from '@packages/kernel/index.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { LocaleContext } from '../context/locale-context.js';
import {
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
  type SupportedLocale,
} from '../contracts/i18n.contract.js';
import {
  getRegistryDefaultLocaleCode,
  getRegistryDefaultTimezoneCode,
  isSupportedLocale,
  isValidIanaTimezone,
  resolveRequestLocale,
  resolveRequestTimezone,
} from '../resolvers/header-locale.resolver.js';

@Injectable()
export class LocaleMiddleware implements NestMiddleware {
  /** Thiết lập locale & timezone hoạt động cho ngữ cảnh request hiện tại */
  public use(req: FastifyRequest['raw'], _res: FastifyReply['raw'], next: () => void): void {
    const dbDefaultLocale = getRegistryDefaultLocaleCode();
    const configuredLocale = defaultSettingRegistry.getValue<string>('ui.locale.default');
    const defaultLocale: SupportedLocale =
      configuredLocale &&
      isSupportedLocale(configuredLocale) &&
      (!dbDefaultLocale || configuredLocale.trim().toLowerCase() !== DEFAULT_LOCALE)
        ? configuredLocale.trim().toLowerCase()
        : dbDefaultLocale && isSupportedLocale(dbDefaultLocale)
          ? dbDefaultLocale
          : isSupportedLocale(configuredLocale)
            ? configuredLocale.trim().toLowerCase()
            : DEFAULT_LOCALE;

    const dbDefaultTz = getRegistryDefaultTimezoneCode();
    const configuredTimezone = defaultSettingRegistry.getValue<string>('ui.timezone.default');
    const defaultTimezone =
      configuredTimezone &&
      isValidIanaTimezone(configuredTimezone) &&
      (!dbDefaultTz || configuredTimezone.trim() !== DEFAULT_TIMEZONE)
        ? configuredTimezone.trim()
        : dbDefaultTz && isValidIanaTimezone(dbDefaultTz)
          ? dbDefaultTz
          : isValidIanaTimezone(configuredTimezone)
            ? configuredTimezone!.trim()
            : DEFAULT_TIMEZONE;

    const { locale, explicitLocale } = resolveRequestLocale(req.headers, defaultLocale);
    const { timezone, explicitTimezone } = resolveRequestTimezone(req.headers, defaultTimezone);

    LocaleContext.run(locale, next, {
      timezone,
      explicitLocale,
      explicitTimezone,
    });
  }
}

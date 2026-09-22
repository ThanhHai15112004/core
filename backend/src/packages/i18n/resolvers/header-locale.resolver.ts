import type { SupportedLocale } from '../contracts/i18n.contract.js';

export const SUPPORTED_LOCALES: readonly SupportedLocale[] = ['vi', 'en'];

/** Lấy locale đầu tiên được hỗ trợ trong header `Accept-Language` (vd. `en-US,en;q=0.9`). */
export function resolveHeaderLocale(
  acceptLanguage?: string,
  defaultLocale: SupportedLocale = 'vi',
): SupportedLocale {
  if (!acceptLanguage) {
    return defaultLocale;
  }

  for (const part of acceptLanguage.split(',')) {
    const lang = part.split(';')[0]?.trim().toLowerCase().slice(0, 2);
    const match = SUPPORTED_LOCALES.find((locale) => locale === lang);
    if (match) {
      return match;
    }
  }

  return defaultLocale;
}

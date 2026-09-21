import type { SupportedLocale } from '../contracts/i18n.contract.js';

export function resolveHeaderLocale(
  acceptLanguage?: string,
  defaultLocale: SupportedLocale = 'vi',
): SupportedLocale {
  if (!acceptLanguage) {
    return defaultLocale;
  }
  const normalized = acceptLanguage.toLowerCase();
  if (normalized.startsWith('en')) {
    return 'en';
  }
  return 'vi';
}

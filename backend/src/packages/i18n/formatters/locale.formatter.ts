import type { SupportedLocale } from '../contracts/i18n.contract.js';

export class LocaleFormatter {
  public static formatCurrency(amount: number, locale: SupportedLocale = 'vi'): string {
    const currency = locale === 'vi' ? 'VND' : 'USD';
    return new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  }

  public static formatDate(date: Date, locale: SupportedLocale = 'vi'): string {
    return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }
}

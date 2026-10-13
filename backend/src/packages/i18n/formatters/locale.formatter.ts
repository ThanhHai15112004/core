import type { SupportedLocale } from '../contracts/i18n.contract.js';

export class LocaleFormatter {
  /** Định dạng giá trị tiền tệ theo locale và đơn vị tiền tệ chuẩn */
  public static formatCurrency(amount: number, locale: SupportedLocale = 'vi'): string {
    const currency = locale === 'vi' ? 'VND' : 'USD';
    return new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  }

  /** Định dạng ngày tháng theo locale và mẫu định dạng chỉ định */
  public static formatDate(date: Date, locale: SupportedLocale = 'vi'): string {
    return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }
}

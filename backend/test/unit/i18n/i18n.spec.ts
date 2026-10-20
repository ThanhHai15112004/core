import { describe, it, expect } from '@jest/globals';
import {
  CoreI18nService,
  I18N_ITEM_STATUS,
  LocaleContext,
  LocaleFormatter,
  isSupportedLocale,
  isValidIanaTimezone,
  resetRegisteredLocales,
  resetRegisteredTimezones,
  resolveHeaderLocale,
  resolveRequestLocale,
  resolveRequestTimezone,
} from '@packages/i18n/index.js';
import { defaultSettingRegistry } from '@packages/kernel/index.js';
import { I18nManagementService } from '@modules/settings/index.js';

describe('i18n & Timezone / Locale Formatting (Section 5.3)', () => {
  const i18n = new CoreI18nService();

  describe('resolveHeaderLocale & resolveRequestLocale / Timezone', () => {
    it.each([
      [undefined, 'vi'],
      ['en', 'en'],
      ['en-US,en;q=0.9', 'en'],
      ['fr-FR,en;q=0.8', 'en'],
      ['vi-VN', 'vi'],
      ['ja', 'vi'],
    ])('resolves %p to %p', (header, expected) => {
      expect(resolveHeaderLocale(header)).toBe(expected);
    });

    it('resolves explicit locale & timezone from headers and applies user preferences when headers are omitted', () => {
      const noHeaderLocale = resolveRequestLocale({});
      expect(noHeaderLocale).toEqual({ locale: 'vi', explicitLocale: false });

      const explicitEn = resolveRequestLocale({ 'accept-language': 'en-US,en;q=0.9' });
      expect(explicitEn).toEqual({ locale: 'en', explicitLocale: true });

      const explicitTz = resolveRequestTimezone({ 'x-timezone': 'America/New_York' });
      expect(explicitTz).toEqual({ timezone: 'America/New_York', explicitTimezone: true });

      expect(isValidIanaTimezone('Asia/Ho_Chi_Minh')).toBe(true);
      expect(isValidIanaTimezone('UTC')).toBe(true);
      expect(isValidIanaTimezone('Invalid/Timezone_999')).toBe(false);

      // When no explicit header was sent, applyUserPreferences overrides active locale & timezone
      LocaleContext.run(
        'vi',
        () => {
          expect(LocaleContext.get()).toBe('vi');
          expect(LocaleContext.getTimezone()).toBe('Asia/Ho_Chi_Minh');

          LocaleContext.applyUserPreferences({
            preferredLocale: 'en',
            preferredTimezone: 'Asia/Tokyo',
          });

          expect(LocaleContext.get()).toBe('en');
          expect(LocaleContext.getTimezone()).toBe('Asia/Tokyo');
        },
        { timezone: 'Asia/Ho_Chi_Minh', explicitLocale: false, explicitTimezone: false },
      );

      // When explicit header WAS sent, applyUserPreferences preserves the explicit request header
      LocaleContext.run(
        'vi',
        () => {
          LocaleContext.applyUserPreferences({
            preferredLocale: 'en',
            preferredTimezone: 'Asia/Tokyo',
          });
          expect(LocaleContext.get()).toBe('vi');
          expect(LocaleContext.getTimezone()).toBe('UTC');
        },
        { timezone: 'UTC', explicitLocale: true, explicitTimezone: true },
      );
    });
  });

  describe('CoreI18nService', () => {
    it('uses default locale outside of a request context and reads ui.locale.default from SettingRegistry', () => {
      expect(i18n.getDefaultLocale()).toBe('vi');
      expect(i18n.getDefaultTimezone()).toBe('Asia/Ho_Chi_Minh');
      expect(i18n.getCurrentLocale()).toBe('vi');
      expect(i18n.t('NOT_FOUND')).toBe('Không tìm thấy dữ liệu yêu cầu');

      // Dynamic default locale change via SettingRegistry (5.3.1)
      defaultSettingRegistry.setGlobalValue('ui.locale.default', 'en');
      try {
        expect(i18n.getDefaultLocale()).toBe('en');
        expect(i18n.t('NOT_FOUND')).toBe('Requested resource not found');
      } finally {
        defaultSettingRegistry.setGlobalValue('ui.locale.default', 'vi');
      }
    });

    it('uses the locale of the current request context', () => {
      const message = LocaleContext.run('en', () => i18n.t('NOT_FOUND'));
      expect(message).toBe('Requested resource not found');
    });

    it('interpolates both {param} and {{param}} placeholders', () => {
      expect(i18n.t('ops.package.notFound', { packageId: 'x' }, 'en')).toBe(
        'Package [x] does not exist in the system.',
      );

      i18n.registerNamespace('settings', {
        vi: { settingNotFound: "Không tìm thấy cấu hình hệ thống '{{key}}'" },
        en: { settingNotFound: "System setting '{{key}}' was not found" },
      });

      expect(i18n.t('settings.settingNotFound', { key: 'ui.locale.default' }, 'vi')).toBe(
        "Không tìm thấy cấu hình hệ thống 'ui.locale.default'",
      );
      expect(i18n.t('settings.settingNotFound', { key: 'ui.locale.default' }, 'en')).toBe(
        "System setting 'ui.locale.default' was not found",
      );
    });

    it('returns the key itself when it is not a translation key', () => {
      expect(i18n.t('Plain message')).toBe('Plain message');
    });

    it('keeps vi and en dictionaries in sync', async () => {
      const load = async (locale: string, ns: string) =>
        Object.keys(
          (
            (await import(`../../../src/packages/i18n/locales/${locale}/${ns}.json`, {
              with: { type: 'json' },
            })) as { default: Record<string, string> }
          ).default,
        ).sort();

      for (const ns of ['common', 'ops', 'overview', 'runtime']) {
        expect(await load('en', ns)).toEqual(await load('vi', ns));
      }
    });
  });

  describe('LocaleFormatter — UTC to User Timezone, Date, Number & Currency (5.3.4, 5.3.5, 5.3.6)', () => {
    it('formats UTC timestamp into user selected timezone accurately across day boundaries', () => {
      // 2026-10-20T18:30:00.000Z is 20/10/2026 18:30:00 in UTC, but 21/10/2026 01:30:00 in Asia/Ho_Chi_Minh (+07:00)
      const utcIso = '2026-10-20T18:30:00.000Z';

      expect(LocaleFormatter.formatReportDateTime(utcIso, 'UTC')).toBe('20/10/2026 18:30:00');
      expect(LocaleFormatter.formatReportDateOnly(utcIso, 'UTC')).toBe('20/10/2026');

      expect(LocaleFormatter.formatReportDateTime(utcIso, 'Asia/Ho_Chi_Minh')).toBe(
        '21/10/2026 01:30:00',
      );
      expect(LocaleFormatter.formatReportDateOnly(utcIso, 'Asia/Ho_Chi_Minh')).toBe('21/10/2026');

      expect(LocaleFormatter.formatReportDateTime(utcIso, 'Asia/Tokyo')).toBe(
        '21/10/2026 03:30:00',
      );
    });

    it('formats numbers, percentages, and currencies according to locale and currency code', () => {
      const vnd = LocaleFormatter.formatCurrency(1250000, 'vi', 'VND');
      expect(vnd).toContain('1.250.000');

      const usd = LocaleFormatter.formatCurrency(1250.5, 'en', 'USD');
      expect(usd).toContain('$1,250.50');

      expect(LocaleFormatter.formatNumber(1234567.89, 'vi')).toBe('1.234.567,89');
      expect(LocaleFormatter.formatNumber(1234567.89, 'en')).toBe('1,234,567.89');
      expect(LocaleFormatter.formatPercent(85.5, 'en', 1)).toBe('85.5%');
    });

    it('dynamically manages locales (i18n_locales), timezones (i18n_timezones) and translations (i18n_translations)', async () => {
      const i18nMgmt = new I18nManagementService(null, null, null, i18n, null);
      try {
        const syncRes = await i18nMgmt.syncDatabaseCatalog();
        expect(syncRes.totalLocales).toBeGreaterThanOrEqual(2);
        expect(syncRes.totalTimezones).toBeGreaterThanOrEqual(8);
        expect(syncRes.totalTranslations).toBeGreaterThan(20);

        // Add new dynamic locale 'ja' (Japanese) into i18n_locales
        const jaLocale = await i18nMgmt.createLocale({
          code: 'ja',
          bcp47Tag: 'ja-JP',
          name: 'Japanese',
          nativeName: '日本語',
          direction: 'ltr',
          dateFormat: 'yyyy/MM/dd',
          datetimeFormat: 'yyyy/MM/dd HH:mm:ss',
          currencyCode: 'JPY',
          numberDecimalSeparator: '.',
          numberGroupSeparator: ',',
          isDefault: false,
          sortOrder: 3,
          status: I18N_ITEM_STATUS.ACTIVE,
        });
        expect(jaLocale.code).toBe('ja');
        expect(isSupportedLocale('ja')).toBe(true);

        // Upsert dynamic translation for 'ja' into i18n_translations
        await i18nMgmt.upsertTranslation({
          locale: 'ja',
          namespace: 'common',
          key: 'NOT_FOUND',
          value: '要求されたリソースが見つかりません',
          status: I18N_ITEM_STATUS.ACTIVE,
        });
        expect(i18n.t('NOT_FOUND', undefined, 'ja')).toBe('要求されたリソースが見つかりません');

        // Dynamic date & currency formatting according to 'ja' metadata in i18n_locales
        const utcIso = '2026-10-20T18:30:00.000Z';
        expect(LocaleFormatter.formatReportDateOnly(utcIso, 'Asia/Tokyo', 'ja')).toBe('2026/10/21');
        expect(LocaleFormatter.formatCurrency(5000, 'ja')).toContain('5,000');

        // Add new dynamic timezone 'Australia/Sydney' into i18n_timezones and set as default
        const sydneyTz = await i18nMgmt.createTimezone({
          code: 'Australia/Sydney',
          name: 'Giờ chuẩn Đông Úc (Sydney)',
          labels: { vi: 'Giờ Sydney (UTC+10:00)', en: 'Sydney Time (UTC+10:00)' },
          utcOffset: '+10:00',
          utcOffsetMinutes: 600,
          region: 'Oceania',
          isDefault: true,
          sortOrder: 9,
          status: I18N_ITEM_STATUS.ACTIVE,
        });
        expect(sydneyTz.isDefault).toBe(true);
        expect(i18n.getDefaultTimezone()).toBe('Australia/Sydney');
      } finally {
        resetRegisteredLocales();
        resetRegisteredTimezones();
        defaultSettingRegistry.setGlobalValue('ui.locale.default', 'vi');
        defaultSettingRegistry.setGlobalValue('ui.timezone.default', 'Asia/Ho_Chi_Minh');
        defaultSettingRegistry.setGlobalValue('ui.currency.default', 'VND');
      }
    });
  });
});

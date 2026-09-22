import { describe, it, expect } from '@jest/globals';
import { CoreI18nService, LocaleContext, resolveHeaderLocale } from '@packages/i18n/index.js';

describe('i18n', () => {
  const i18n = new CoreI18nService();

  describe('resolveHeaderLocale', () => {
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
  });

  describe('CoreI18nService', () => {
    it('uses default locale outside of a request context', () => {
      expect(i18n.getCurrentLocale()).toBe('vi');
      expect(i18n.t('NOT_FOUND')).toBe('Không tìm thấy dữ liệu yêu cầu');
    });

    it('uses the locale of the current request context', () => {
      const message = LocaleContext.run('en', () => i18n.t('NOT_FOUND'));
      expect(message).toBe('Requested resource not found');
    });

    it('interpolates params', () => {
      expect(i18n.t('ops.package.notFound', { packageId: 'x' }, 'en')).toBe(
        'Package [x] does not exist in the system.',
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
});

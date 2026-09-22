import { AsyncLocalStorage } from 'node:async_hooks';
import type { SupportedLocale } from '../contracts/i18n.contract.js';

const storage = new AsyncLocalStorage<SupportedLocale>();

/** Locale của request hiện tại, được gán bởi `LocaleMiddleware`. */
export const LocaleContext = {
  run<R>(locale: SupportedLocale, callback: () => R): R {
    return storage.run(locale, callback);
  },
  get(): SupportedLocale | undefined {
    return storage.getStore();
  },
};

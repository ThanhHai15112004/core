import { AsyncLocalStorage } from 'node:async_hooks';
import type { SupportedLocale } from '../contracts/i18n.contract.js';

const storage = new AsyncLocalStorage<SupportedLocale>();

/** Locale của request hiện tại, được gán bởi `LocaleMiddleware`. */
export const LocaleContext = {
  /** Thực thi thao tác vận hành với cơ chế theo dõi và xử lý lỗi */
  run<R>(locale: SupportedLocale, callback: () => R): R {
    return storage.run(locale, callback);
  },
  /** Lấy dữ liệu hoặc đối tượng theo khóa định danh */
  get(): SupportedLocale | undefined {
    return storage.getStore();
  },
};

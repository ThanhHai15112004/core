import { createContext, useContext } from 'react';
import type { SupportedLocale, TranslateParams } from './translate';

export interface LocaleContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  toggleLocale: () => void;
  t: (path: string, params?: TranslateParams) => string;
  formatTime: (value: Date | string | number, withSeconds?: boolean) => string;
  formatRelative: (value: Date | string | number, now?: number) => string;
}

export const LocaleContext = createContext<LocaleContextValue | null>(null);

export const useLocale = (): LocaleContextValue => {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return context;
};

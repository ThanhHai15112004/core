import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { LocaleContext } from './locale-context';
import {
  type SupportedLocale,
  type TranslateParams,
  LOCALE_STORAGE_KEY,
  formatTime,
  isSupportedLocale,
  readStoredLocale,
  setActiveLocale,
  translate,
} from './translate';

export const LocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<SupportedLocale>(readStoredLocale);

  useEffect(() => {
    setActiveLocale(locale);
  }, [locale]);

  const setLocale = useCallback((newLocale: SupportedLocale) => {
    setActiveLocale(newLocale);
    setLocaleState(newLocale);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
    } catch {
      // Ignore
    }
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'vi' ? 'en' : 'vi');
  }, [locale, setLocale]);

  // Đồng bộ khi tab khác đổi ngôn ngữ
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === LOCALE_STORAGE_KEY && isSupportedLocale(e.newValue)) {
        setLocale(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [setLocale]);

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      toggleLocale,
      t: (path: string, params?: TranslateParams) => translate(locale, path, params),
      formatTime: (v: Date | string | number, withSeconds?: boolean) => formatTime(v, locale, withSeconds),
    }),
    [locale, setLocale, toggleLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

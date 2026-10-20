import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { LocaleContext } from './locale-context';
import {
  type SupportedLocale,
  type TranslateParams,
  LOCALE_STORAGE_KEY,
  TIMEZONE_STORAGE_KEY,
  formatTime,
  formatRelative,
  isSupportedLocale,
  isValidTimezone,
  readStoredLocale,
  readStoredTimezone,
  setActiveLocale,
  setActiveTimezone,
  translate,
} from './translate';

export const LocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<SupportedLocale>(readStoredLocale);
  const [timezone, setTimezoneState] = useState<string>(readStoredTimezone);

  useEffect(() => {
    setActiveLocale(locale);
  }, [locale]);

  useEffect(() => {
    setActiveTimezone(timezone);
  }, [timezone]);

  const setLocale = useCallback((newLocale: SupportedLocale) => {
    setActiveLocale(newLocale);
    setLocaleState(newLocale);
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
    } catch {
      // Ignore
    }
  }, []);

  const setTimezone = useCallback((newTimezone: string) => {
    if (!isValidTimezone(newTimezone)) return;
    const trimmed = newTimezone.trim();
    setActiveTimezone(trimmed);
    setTimezoneState(trimmed);
    try {
      localStorage.setItem(TIMEZONE_STORAGE_KEY, trimmed);
    } catch {
      // Ignore
    }
  }, []);

  const toggleLocale = useCallback(() => {
    setLocale(locale === 'vi' ? 'en' : 'vi');
  }, [locale, setLocale]);

  // Đồng bộ khi tab khác đổi ngôn ngữ hoặc múi giờ
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === LOCALE_STORAGE_KEY && isSupportedLocale(e.newValue)) {
        setLocale(e.newValue);
      } else if (e.key === TIMEZONE_STORAGE_KEY && isValidTimezone(e.newValue)) {
        setTimezone(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [setLocale, setTimezone]);

  const value = useMemo(
    () => ({
      locale,
      timezone,
      setLocale,
      setTimezone,
      toggleLocale,
      t: (path: string, params?: TranslateParams) => translate(locale, path, params),
      formatTime: (v: Date | string | number, withSeconds?: boolean) =>
        formatTime(v, locale, withSeconds, timezone),
      formatRelative: (v: Date | string | number, now?: number) => formatRelative(v, locale, now),
    }),
    [locale, timezone, setLocale, setTimezone, toggleLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

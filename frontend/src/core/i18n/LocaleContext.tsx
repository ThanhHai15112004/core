import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { vi } from './locales/vi';
import { en } from './locales/en';

export type SupportedLocale = 'vi' | 'en';

interface LocaleContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  toggleLocale: () => void;
  t: (path: string, params?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

const LOCALE_STORAGE_KEY = 'scp_locale';

const dictionaries = { vi, en };

export const LocaleProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<SupportedLocale>(() => {
    try {
      const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (saved === 'vi' || saved === 'en') return saved;
    } catch {
      // Fallback
    }
    return 'vi'; // Mặc định tiếng Việt theo yêu cầu của người dùng
  });

  const setLocale = useCallback((newLocale: SupportedLocale) => {
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

  // Sync state if localStorage changes elsewhere
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === LOCALE_STORAGE_KEY && (e.newValue === 'vi' || e.newValue === 'en')) {
        setLocaleState(e.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const t = useCallback(
    (path: string, params?: Record<string, string | number>): string => {
      const dict = dictionaries[locale] || dictionaries.vi;
      const fallbackDict = dictionaries.en;

      const resolveValue = (target: unknown, p: string): unknown => {
        const parts = p.split('.');
        let cur: unknown = target;
        for (const part of parts) {
          if (cur && typeof cur === 'object' && part in cur) {
            cur = (cur as Record<string, unknown>)[part];
          } else {
            return undefined;
          }
        }
        return cur;
      };

      let result = resolveValue(dict, path);
      if (typeof result !== 'string') {
        result = resolveValue(fallbackDict, path);
      }

      if (typeof result !== 'string') {
        return path;
      }

      if (params) {
        return Object.entries(params).reduce((acc, [key, val]) => {
          return acc.replace(new RegExp(`{{${key}}}`, 'g'), String(val));
        }, result);
      }

      return result;
    },
    [locale],
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      toggleLocale,
      t,
    }),
    [locale, setLocale, toggleLocale, t],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
};

export const useLocale = (): LocaleContextValue => {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return context;
};

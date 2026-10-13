import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeContext, isTheme, type Theme } from './theme-context';

interface ThemeProviderProps {
  children: React.ReactNode;
  /** Khoá localStorage lưu lựa chọn của người dùng. */
  storageKey: string;
  /** Theme khi người dùng chưa chọn; `system` = theo `prefers-color-scheme`. */
  defaultTheme?: Theme | 'system';
}

function readStored(key: string): Theme | null {
  try {
    const v = localStorage.getItem(key);
    return isTheme(v) ? v : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

function systemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * Đặt `data-theme` lên `<html>` (để cả nội dung portal cũng nhận token màu) và gỡ khi unmount,
 * nên trang không dùng kit (Home) không bị ảnh hưởng.
 */
export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children, storageKey, defaultTheme = 'dark' }) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    const initial = readStored(storageKey) ?? (defaultTheme === 'system' ? systemTheme() : defaultTheme);
    applyTheme(initial);
    return initial;
  });

  const setTheme = useCallback(
    (next: Theme) => {
      // Gắn attribute TRƯỚC khi render lại để `useThemeTokens` đọc được giá trị CSS mới ngay trong lần render đó.
      applyTheme(next);
      setThemeState(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        /* storage bị chặn: chỉ đổi trong phiên */
      }
    },
    [storageKey],
  );

  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [theme, setTheme]);

  useEffect(() => {
    applyTheme(theme);
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

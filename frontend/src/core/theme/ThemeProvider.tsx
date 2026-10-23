import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ThemeContext, isTheme, type Theme } from './theme-context';
import { DEFAULT_SYSTEM_THEME, SYSTEM_THEME_CONFIG, SYSTEM_THEME_STORAGE_KEY } from './theme.config';

interface ThemeProviderProps {
  children: React.ReactNode;
  /** Khoá localStorage lưu lựa chọn của người dùng. */
  storageKey?: string;
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
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = theme;
  const palette = SYSTEM_THEME_CONFIG[theme];
  root.style.setProperty('--theme-primary', palette.primary);
  root.style.setProperty('--theme-primary-hover', palette.primaryHover);
  root.style.setProperty('--theme-primary-light', palette.primaryLight);
  root.style.setProperty('--theme-secondary', palette.secondary);
  root.style.setProperty('--theme-secondary-light', palette.secondaryLight);
  root.style.setProperty('--theme-accent', palette.accent);
  root.style.setProperty('--theme-accent-light', palette.accentLight);
  root.style.setProperty('--theme-bg', palette.background);
  root.style.setProperty('--theme-surface', palette.surface);
  root.style.setProperty('--theme-surface-elevated', palette.surfaceElevated);
  root.style.setProperty('--theme-surface-glass', palette.surfaceGlass);
  root.style.setProperty('--theme-text', palette.text);
  root.style.setProperty('--theme-text-secondary', palette.textSecondary);
  root.style.setProperty('--theme-text-muted', palette.textMuted);
  root.style.setProperty('--theme-border', palette.border);
  root.style.setProperty('--theme-border-strong', palette.borderStrong);
}

function systemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Đặt `data-theme` và biến CSS hệ thống lên `<html>` để toàn bộ trang và portal nhận bộ màu chuẩn.
 */
export const ThemeProvider: React.FC<ThemeProviderProps> = ({
  children,
  storageKey = SYSTEM_THEME_STORAGE_KEY,
  defaultTheme = DEFAULT_SYSTEM_THEME,
}) => {
  const [theme, setThemeState] = useState<Theme>(() => {
    const initial = readStored(storageKey) ?? (defaultTheme === 'system' ? systemTheme() : defaultTheme);
    applyTheme(initial);
    return initial;
  });

  const setTheme = useCallback(
    (next: Theme) => {
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
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

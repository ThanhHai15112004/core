import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type { ConsoleTheme } from '../types/console.types';
import { CONSOLE_STORAGE_KEYS } from '../constants/console.constants';
import { ConsoleThemeContext } from './console-theme-context';

export const ConsoleThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ConsoleTheme>(() => {
    const saved = localStorage.getItem(CONSOLE_STORAGE_KEYS.THEME);
    return saved === 'dark' ? 'dark' : 'light'; // Light is default as requested
  });

  const setTheme = useCallback((newTheme: ConsoleTheme) => {
    setThemeState(newTheme);
    localStorage.setItem(CONSOLE_STORAGE_KEYS.THEME, newTheme);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  useEffect(() => {
    localStorage.setItem(CONSOLE_STORAGE_KEYS.THEME, theme);
  }, [theme]);

  const value = useMemo(() => ({ theme, toggleTheme, setTheme }), [theme, toggleTheme, setTheme]);

  return (
    <ConsoleThemeContext.Provider value={value}>
      {children}
    </ConsoleThemeContext.Provider>
  );
};

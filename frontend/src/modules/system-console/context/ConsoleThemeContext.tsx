import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import type { ConsoleTheme } from '../types/console.types';
import { CONSOLE_STORAGE_KEYS } from '../constants/console.constants';

export interface ConsoleThemeContextValue {
  theme: ConsoleTheme;
  toggleTheme: () => void;
  setTheme: (theme: ConsoleTheme) => void;
}

export const ConsoleThemeContext = createContext<ConsoleThemeContextValue | null>(null);

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

export const useConsoleTheme = (): ConsoleThemeContextValue => {
  const context = useContext(ConsoleThemeContext);
  if (!context) {
    throw new Error('useConsoleTheme must be used within a ConsoleThemeProvider');
  }
  return context;
};

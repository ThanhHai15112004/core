import { createContext, useContext } from 'react';
import type { ConsoleTheme } from '../types/console.types';

export interface ConsoleThemeContextValue {
  theme: ConsoleTheme;
  toggleTheme: () => void;
  setTheme: (theme: ConsoleTheme) => void;
}

export const ConsoleThemeContext = createContext<ConsoleThemeContextValue | null>(null);

export const useConsoleTheme = (): ConsoleThemeContextValue => {
  const context = useContext(ConsoleThemeContext);
  if (!context) {
    throw new Error('useConsoleTheme must be used within a ConsoleThemeProvider');
  }
  return context;
};

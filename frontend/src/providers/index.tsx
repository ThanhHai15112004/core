import React from 'react';
import { DEFAULT_SYSTEM_THEME, SYSTEM_THEME_STORAGE_KEY, ThemeProvider } from '../core/theme/index';

export interface AppProvidersProps {
  children: React.ReactNode;
}

export const AppProviders: React.FC<AppProvidersProps> = ({ children }) => {
  return (
    <ThemeProvider storageKey={SYSTEM_THEME_STORAGE_KEY} defaultTheme={DEFAULT_SYSTEM_THEME}>
      {children}
    </ThemeProvider>
  );
};

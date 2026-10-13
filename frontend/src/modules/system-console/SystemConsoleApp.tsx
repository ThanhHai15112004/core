import React from 'react';
import '@core/theme/theme.css';
import './styles/index.css';
import { Toaster } from 'sonner';
import { ThemeProvider, useTheme } from '@core/theme';
import { DataProvider } from '@core/data';
import { TooltipProvider } from '@core/ui/primitives';
import { TOAST_DURATION_MS } from '@core/constants/ui.constants';
import { CONSOLE_STORAGE_KEYS } from './constants/console.constants';
import { ConsoleDataProvider } from './context/ConsoleDataContext';
import { SystemConsoleRouter } from './SystemConsoleRouter';

const ThemedToaster: React.FC = () => {
  const { theme } = useTheme();
  return <Toaster theme={theme} position="bottom-right" duration={TOAST_DURATION_MS} closeButton />;
};

export const SystemConsoleApp: React.FC = () => {
  return (
    <ThemeProvider storageKey={CONSOLE_STORAGE_KEYS.THEME} defaultTheme="dark">
      <DataProvider>
        <TooltipProvider>
          <ConsoleDataProvider>
            <SystemConsoleRouter />
          </ConsoleDataProvider>
          <ThemedToaster />
        </TooltipProvider>
      </DataProvider>
    </ThemeProvider>
  );
};

export default SystemConsoleApp;

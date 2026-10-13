import React from 'react';
import '@core/theme/theme.css';
import { Toaster } from 'sonner';
import { ThemeProvider, useTheme } from '@core/theme';
import { DataProvider } from '@core/data';
import { TooltipProvider } from '@core/ui/primitives';
import { TOAST_DURATION_MS } from '@core/constants/ui.constants';
import { CONSOLE_STORAGE_KEYS } from './constants/console.constants';
import { ConsoleDataProvider } from './context/ConsoleDataContext';
import { SystemConsoleRouter } from './SystemConsoleRouter';

/** Màu toast lấy từ token theme (biến CSS của sonner). */
const TOASTER_TOKENS = {
  '--normal-bg': 'var(--ui-panel-2)',
  '--normal-border': 'var(--ui-border-strong)',
  '--normal-text': 'var(--ui-text)',
  '--success-bg': 'var(--ui-panel-2)',
  '--success-border': 'var(--ui-ok-border)',
  '--success-text': 'var(--ui-ok-fg)',
  '--error-bg': 'var(--ui-panel-2)',
  '--error-border': 'var(--ui-crit-border)',
  '--error-text': 'var(--ui-crit-fg)',
  '--warning-bg': 'var(--ui-panel-2)',
  '--warning-border': 'var(--ui-warn-border)',
  '--warning-text': 'var(--ui-warn-fg)',
  '--info-bg': 'var(--ui-panel-2)',
  '--info-border': 'var(--ui-info-border)',
  '--info-text': 'var(--ui-info-fg)',
} as React.CSSProperties;

const ThemedToaster: React.FC = () => {
  const { theme } = useTheme();
  return <Toaster theme={theme} richColors position="bottom-right" duration={TOAST_DURATION_MS} closeButton style={TOASTER_TOKENS} />;
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

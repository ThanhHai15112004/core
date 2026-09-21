import React from 'react';
import './styles/index.css';
import { ConsoleThemeProvider } from './context/ConsoleThemeContext';
import { ConsoleDataProvider } from './context/ConsoleDataContext';
import { SystemConsoleRouter } from './SystemConsoleRouter';

export const SystemConsoleApp: React.FC = () => {
  return (
    <ConsoleThemeProvider>
      <ConsoleDataProvider>
        <SystemConsoleRouter />
      </ConsoleDataProvider>
    </ConsoleThemeProvider>
  );
};

export default SystemConsoleApp;

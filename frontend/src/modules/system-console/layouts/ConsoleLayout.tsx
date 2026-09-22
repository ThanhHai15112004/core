import React from 'react';
import type { ConsolePath, ConsoleSectionId } from '../types/console.types';
import { useConsoleTheme } from '../context/console-theme-context';
import { ConsoleSidebar } from './ConsoleSidebar';
import { ConsoleTopBar } from './ConsoleTopBar';
import { ToastContainer } from '../components/common/Toast';

interface ConsoleLayoutProps {
  currentSection: ConsoleSectionId;
  onNavigate: (path: ConsolePath) => void;
  children: React.ReactNode;
}

export const ConsoleLayout: React.FC<ConsoleLayoutProps> = ({
  currentSection,
  onNavigate,
  children,
}) => {
  const { theme } = useConsoleTheme();

  return (
    <div className="console-root" data-theme={theme}>
      <div className="console-layout">
        <ConsoleSidebar
          currentSection={currentSection}
          onNavigate={onNavigate}
        />
        <div className="console-main-wrapper">
          <ConsoleTopBar currentSection={currentSection} />
          <main className="console-content-container">
            {children}
          </main>
        </div>
      </div>
      <ToastContainer />
    </div>
  );
};

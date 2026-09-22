import React, { useState, useEffect, useCallback } from 'react';
import type { ConsoleSectionId } from './types/console.types';
import { CONSOLE_STORAGE_KEYS } from './constants/console.constants';
import { ConsoleLayout } from './layouts/ConsoleLayout';
import { OverviewSection } from './sections/OverviewSection';
import { RuntimeSection } from './sections/RuntimeSection';
import { PackagesSection } from './sections/PackagesSection';
import { LogViewerSection } from './sections/LogViewerSection';
import { WorkerSection } from './sections/WorkerSection';
import { SchedulerSection } from './sections/SchedulerSection';
import { DatabaseSection } from './sections/DatabaseSection';
import { CacheSection } from './sections/CacheSection';
import { SecuritySection } from './sections/SecuritySection';

const VALID_SECTIONS: ConsoleSectionId[] = [
  'overview',
  'runtime',
  'packages',
  'logs',
  'worker',
  'scheduler',
  'database',
  'cache',
  'security',
];

export const SystemConsoleRouter: React.FC = () => {
  const parseSectionFromHash = (): ConsoleSectionId => {
    const hash = window.location.hash.replace(/^#\/?/, '');
    // hash could be "system-console" or "system-console/packages" or "system-console/database"
    if (hash.startsWith('system-console/')) {
      const sub = hash.replace('system-console/', '').toLowerCase() as ConsoleSectionId;
      if (VALID_SECTIONS.includes(sub)) {
        return sub;
      }
    }
    const saved = localStorage.getItem(CONSOLE_STORAGE_KEYS.LAST_SECTION) as ConsoleSectionId;
    if (saved && VALID_SECTIONS.includes(saved)) {
      return saved;
    }
    return 'overview';
  };

  const [currentSection, setCurrentSection] = useState<ConsoleSectionId>(parseSectionFromHash);

  useEffect(() => {
    const handleHashChange = () => {
      const section = parseSectionFromHash();
      setCurrentSection(section);
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const handleSelectSection = useCallback((section: ConsoleSectionId) => {
    setCurrentSection(section);
    localStorage.setItem(CONSOLE_STORAGE_KEYS.LAST_SECTION, section);
    window.location.hash = `#system-console/${section}`;
  }, []);

  const renderSection = () => {
    switch (currentSection) {
      case 'overview':
        return (
<OverviewSection onNavigate={handleSelectSection} />
        );
      case 'runtime':
        return <RuntimeSection />;
      case 'packages':
        return (
          <PackagesSection />
        );
      case 'logs':
        return <LogViewerSection />;
      case 'worker':
        return <WorkerSection />;
      case 'scheduler':
        return <SchedulerSection />;
      case 'database':
        return <DatabaseSection />;
      case 'cache':
        return <CacheSection />;
      case 'security':
        return <SecuritySection />;
      default:
        return (
<OverviewSection onNavigate={handleSelectSection} />
        );
    }
  };

  return (
    <ConsoleLayout
      currentSection={currentSection}
      onSelectSection={handleSelectSection}
    >
      {renderSection()}
    </ConsoleLayout>
  );
};

import { useState, useEffect } from 'react';
import { Header } from './core/layouts/Header';
import { Footer } from './core/layouts/Footer';
import { Home } from './modules/home/pages/Home';
import { SystemOpsPage } from './modules/system-ops/pages/SystemOpsPage';
import { SystemConsoleApp } from './modules/system-console/SystemConsoleApp';
import { AppProviders } from './providers/index';
import type { NavigationTabId } from './core/constants/index';
import { ROUTES } from './routes/index';

import { LocaleProvider } from './core/i18n/index';

function App() {
  const [activeTab, setActiveTab] = useState<NavigationTabId>('home');
  const [isConsoleMode, setIsConsoleMode] = useState<boolean>(() => {
    return window.location.hash.startsWith(ROUTES.SYSTEM_CONSOLE);
  });

  useEffect(() => {
    const handleHashChange = () => {
      setIsConsoleMode(window.location.hash.startsWith(ROUTES.SYSTEM_CONSOLE));
    };

    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  return (
    <LocaleProvider>
      {isConsoleMode ? (
        <SystemConsoleApp />
      ) : (
        <AppProviders>
          <Header activeTab={activeTab} onTabChange={setActiveTab} />
          {activeTab === 'home' ? <Home /> : <SystemOpsPage />}
          <Footer />
        </AppProviders>
      )}
    </LocaleProvider>
  );
}

export default App;


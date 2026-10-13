import { lazy, Suspense, useState, useEffect } from 'react';
import { Header } from './core/layouts/Header';
import { Footer } from './core/layouts/Footer';
import { Home } from './modules/home/pages/Home';
import { AppProviders } from './providers/index';
import type { NavigationTabId } from './core/constants/index';
import { ROUTES } from './routes/index';

import { LocaleProvider } from './core/i18n/index';

// Tải riêng: CSS/JS của System Console (Tailwind, ECharts…) chỉ nạp khi vào console.
const SystemConsoleApp = lazy(() => import('./modules/system-console/SystemConsoleApp'));

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
        <Suspense fallback={null}>
          <SystemConsoleApp />
        </Suspense>
      ) : (
        <AppProviders>
          <Header activeTab={activeTab} onTabChange={setActiveTab} />
          <Home />
          <Footer />
        </AppProviders>
      )}
    </LocaleProvider>
  );
}

export default App;


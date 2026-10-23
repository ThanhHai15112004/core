import { lazy, Suspense, useState } from 'react';
import { Header } from './core/layouts/Header';
import { Footer } from './core/layouts/Footer';
import { HomePage } from './web/home/HomePage';
import { AuthManagementPage } from './modules/auth/AuthManagementPage';
import { FileManagerPage } from './modules/files/FileManagerPage';
import { AppProviders } from './providers/index';
import type { NavigationTabId } from './core/constants/index';
import { ROUTES } from './routes/index';

import { LocaleProvider } from './core/i18n/index';
import { migrateHashUrl, useLocation } from './core/router/index';

// Tải riêng: CSS/JS của System Console (Tailwind, ECharts…) chỉ nạp khi vào console.
// Link cũ dạng `/#system-console/...` → đường dẫn thật.
migrateHashUrl(ROUTES.SYSTEM_CONSOLE);

const SystemConsoleApp = lazy(() => import('./modules/system-console/SystemConsoleApp'));

function App() {
  const [activeTab, setActiveTab] = useState<NavigationTabId>('home');
  const { pathname } = useLocation();
  const isConsoleMode =
    pathname === ROUTES.SYSTEM_CONSOLE || pathname.startsWith(`${ROUTES.SYSTEM_CONSOLE}/`);

  return (
    <LocaleProvider>
      {isConsoleMode ? (
        <Suspense fallback={null}>
          <SystemConsoleApp />
        </Suspense>
      ) : (
        <AppProviders>
          <Header activeTab={activeTab} onTabChange={setActiveTab} />
          {activeTab === 'auth' ? (
            <AuthManagementPage />
          ) : activeTab === 'files' ? (
            <FileManagerPage />
          ) : (
            <HomePage onNavigateTab={setActiveTab} />
          )}
          <Footer />
        </AppProviders>
      )}
    </LocaleProvider>
  );
}

export default App;

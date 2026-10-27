import { lazy, Suspense, useCallback, useEffect, type ComponentType } from 'react';
import { Header } from './core/layouts/Header';
import { Footer } from './core/layouts/Footer';
import { AppProviders } from './providers/index';
import {
  resolveRouteForTab,
  resolveTabFromPathname,
  type NavigationTabId,
} from './core/constants/index';
import { ROUTES } from './routes/index';
import { LocaleProvider } from './core/i18n/index';
import { migrateHashUrl, navigateTo, useLocation } from './core/router/index';

// Helper nạp trang theo cơ chế Code-Splitting (React.lazy) tương tự SystemConsoleRouter
const loadPage = <K extends string, P = object>(
  loader: () => Promise<Record<K, ComponentType<P>>>,
  exportName: K,
) => lazy(() => loader().then((m) => ({ default: m[exportName] })));

const HomePage = loadPage(() => import('./web/home/HomePage'), 'HomePage');
const AuthManagementPage = loadPage(
  () => import('./modules/auth/AuthManagementPage'),
  'AuthManagementPage',
);
const OrganizationsManagementPage = loadPage(
  () => import('./modules/organizations/OrganizationsManagementPage'),
  'OrganizationsManagementPage',
);
const RolesManagementPage = loadPage(
  () => import('./modules/roles/RolesManagementPage'),
  'RolesManagementPage',
);
const UsersManagementPage = loadPage(
  () => import('./modules/users/UsersManagementPage'),
  'UsersManagementPage',
);
const CodesManagementPage = loadPage(
  () => import('./modules/codes/CodesManagementPage'),
  'CodesManagementPage',
);
const SettingsManagementPage = loadPage(
  () => import('./modules/settings/SettingsManagementPage'),
  'SettingsManagementPage',
);
const FileManagerPage = loadPage(
  () => import('./modules/files/FileManagerPage'),
  'FileManagerPage',
);
const NotificationsManagementPage = loadPage(
  () => import('./modules/notifications/NotificationsManagementPage'),
  'NotificationsManagementPage',
);
const WorkflowsManagementPage = loadPage(
  () => import('./modules/workflows/WorkflowsManagementPage'),
  'WorkflowsManagementPage',
);

// Tải riêng: CSS/JS của System Console (Tailwind, ECharts…) chỉ nạp khi vào console.
// Link cũ dạng `/#system-console/...` → đường dẫn thật.
migrateHashUrl(ROUTES.SYSTEM_CONSOLE);

const SystemConsoleApp = lazy(() => import('./modules/system-console/SystemConsoleApp'));

function PageSkeletonFallback() {
  return (
    <main
      style={{
        minHeight: 'calc(100vh - 140px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--text-muted)',
        fontSize: '14px',
        fontWeight: 600,
      }}
    >
      Đang tải mô-đun...
    </main>
  );
}

function App() {
  const { pathname } = useLocation();
  const isConsoleMode =
    pathname === ROUTES.SYSTEM_CONSOLE || pathname.startsWith(`${ROUTES.SYSTEM_CONSOLE}/`);
  const activeTab = resolveTabFromPathname(pathname);

  const handleNavigateTab = useCallback((tab: NavigationTabId) => {
    navigateTo(resolveRouteForTab(tab));
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <LocaleProvider>
      {isConsoleMode ? (
        <Suspense fallback={null}>
          <SystemConsoleApp />
        </Suspense>
      ) : (
        <AppProviders>
          <Header activeTab={activeTab} onTabChange={handleNavigateTab} />
          <Suspense fallback={<PageSkeletonFallback />}>
            {activeTab === 'auth' ? (
              <AuthManagementPage />
            ) : activeTab === 'organizations' ? (
              <OrganizationsManagementPage />
            ) : activeTab === 'roles' ? (
              <RolesManagementPage />
            ) : activeTab === 'users' ? (
              <UsersManagementPage />
            ) : activeTab === 'codes' ? (
              <CodesManagementPage />
            ) : activeTab === 'settings' ? (
              <SettingsManagementPage />
            ) : activeTab === 'files' ? (
              <FileManagerPage />
            ) : activeTab === 'notifications' ? (
              <NotificationsManagementPage />
            ) : activeTab === 'workflows' ? (
              <WorkflowsManagementPage />
            ) : (
              <HomePage onNavigateTab={handleNavigateTab} />
            )}
          </Suspense>
          <Footer />
        </AppProviders>
      )}
    </LocaleProvider>
  );
}

export default App;

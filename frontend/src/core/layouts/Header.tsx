import React, { useCallback, useEffect, useState } from 'react';
import {
  APP_NAME,
  NAVIGATION_ITEMS,
  resolveRouteForTab,
  resolveTabFromPathname,
  type NavigationTabId,
} from '../constants/index';
import { ROUTES } from '../../routes/index';
import { useLocale } from '../i18n/index';
import { useTheme } from '../theme/index';
import {
  Home,
  Terminal,
  Boxes,
  Globe,
  ShieldCheck,
  Building2,
  KeyRound,
  Users,
  BookOpen,
  Settings,
  FolderOpen,
  Bell,
  GitBranch,
  Sun,
  Moon,
} from 'lucide-react';
import { navigateTo, useLocation } from '../router/index';
import {
  getStoredAccessToken,
  getStoredRefreshToken,
  IAM_AUTH_CHANGED_EVENT,
} from '../services/api';
import {
  NOTIFICATION_UNREAD_CHANGED_EVENT,
  notificationsApi,
} from '../../modules/notifications/services/notifications.api';

interface HeaderProps {
  activeTab?: NavigationTabId;
  onTabChange?: (tab: NavigationTabId) => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, onTabChange }) => {
  const { pathname } = useLocation();
  const effectiveTab = activeTab ?? resolveTabFromPathname(pathname);
  const { locale, toggleLocale, t } = useLocale();
  const { theme, toggleTheme } = useTheme();
  const [unreadCount, setUnreadCount] = useState<number>(0);

  const handleSelectTab = useCallback(
    (tab: NavigationTabId) => {
      if (onTabChange) {
        onTabChange(tab);
      } else {
        navigateTo(resolveRouteForTab(tab));
      }
    },
    [onTabChange],
  );

  const fetchUnread = useCallback(async () => {
    if (!getStoredAccessToken() && !getStoredRefreshToken()) {
      setUnreadCount(0);
      return;
    }
    try {
      const res = await notificationsApi.getUnreadSummary();
      if (typeof res?.unreadCount === 'number') {
        setUnreadCount(res.unreadCount);
      }
    } catch {
      // Ignore if unauthenticated or offline
    }
  }, []);

  useEffect(() => {
    void fetchUnread();
    const handler = () => void fetchUnread();
    window.addEventListener(NOTIFICATION_UNREAD_CHANGED_EVENT, handler);
    window.addEventListener(IAM_AUTH_CHANGED_EVENT, handler);
    const interval = window.setInterval(handler, 30000);
    return () => {
      window.removeEventListener(NOTIFICATION_UNREAD_CHANGED_EVENT, handler);
      window.removeEventListener(IAM_AUTH_CHANGED_EVENT, handler);
      window.clearInterval(interval);
    };
  }, [fetchUnread]);

  const resolveNavIcon = (id: NavigationTabId) => {
    switch (id) {
      case 'auth':
        return <ShieldCheck size={15} />;
      case 'organizations':
        return <Building2 size={15} />;
      case 'roles':
        return <KeyRound size={15} />;
      case 'users':
        return <Users size={15} />;
      case 'codes':
        return <BookOpen size={15} />;
      case 'settings':
        return <Settings size={15} />;
      case 'files':
        return <FolderOpen size={15} />;
      case 'notifications':
        return <Bell size={15} />;
      case 'workflows':
        return <GitBranch size={15} />;
      case 'home':
      default:
        return <Home size={15} />;
    }
  };

  return (
    <header className="glass header-root">
      <div className="header-content">
        <div onClick={() => handleSelectTab('home')} className="header-brand">
          <div className="header-logo-badge" aria-hidden="true">
            <Boxes size={18} />
          </div>
          <span className="gradient-text header-brand-name">{APP_NAME}</span>
        </div>

        <nav className="header-nav">
          {NAVIGATION_ITEMS.map((item) => {
            const isActive = effectiveTab === item.id;
            const label = t(item.labelKey);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTab(item.id)}
                className={`nav-tab-btn ${isActive ? 'nav-tab-btn-active' : ''}`}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                  {resolveNavIcon(item.id)}
                </span>
                <span>{label}</span>
                {item.id === 'notifications' && unreadCount > 0 && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: 18,
                      height: 18,
                      padding: '0 5px',
                      borderRadius: 99,
                      background: '#EF4444',
                      color: '#FFFFFF',
                      fontSize: 10.5,
                      fontWeight: 800,
                      marginLeft: 2,
                    }}
                  >
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => {
              navigateTo(ROUTES.SYSTEM_CONSOLE);
            }}
            className="nav-tab-btn nav-tab-btn-console"
            title="Open Infrastructure Control Plane"
          >
            <Terminal size={15} />
            <span>{t('header.systemConsole')}</span>
          </button>

          {/* Theme Switch Button (Light / Dark) */}
          <button
            type="button"
            onClick={toggleTheme}
            className="theme-toggle-btn"
            title={theme === 'dark' ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
          >
            {theme === 'dark' ? <Sun size={15} color="#FBBF24" /> : <Moon size={15} color="#2563EB" />}
            <span>{theme === 'dark' ? t('header.themeDark') : t('header.themeLight')}</span>
          </button>

          {/* Language Switch Button */}
          <button
            type="button"
            onClick={toggleLocale}
            className="theme-toggle-btn"
            title={t('header.languageToggle')}
          >
            <Globe size={14} />
            <span style={{ textTransform: 'uppercase', fontWeight: 700 }}>{locale}</span>
          </button>
        </nav>
      </div>
    </header>
  );
};

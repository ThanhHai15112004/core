import React from 'react';
import { APP_NAME, NAVIGATION_ITEMS, type NavigationTabId } from '../constants/index';
import { ROUTES } from '../../routes/index';
import { useLocale } from '../i18n/index';
import { Home, Sliders, Terminal, Boxes, Globe } from 'lucide-react';

interface HeaderProps {
  activeTab?: NavigationTabId;
  onTabChange?: (tab: NavigationTabId) => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab = 'home', onTabChange }) => {
  const { locale, toggleLocale, t } = useLocale();

  const resolveNavIcon = (id: NavigationTabId) => {
    switch (id) {
      case 'home':
        return <Home size={15} />;
      case 'ops':
        return <Sliders size={15} />;
      default:
        return <Home size={15} />;
    }
  };

  return (
    <header className="glass header-root">
      <div className="header-content">
        <div
          onClick={() => onTabChange?.('home')}
          className="header-brand"
        >
          <div className="header-logo-badge" aria-hidden="true">
            <Boxes size={18} />
          </div>
          <span className="gradient-text header-brand-name">
            {APP_NAME}
          </span>
        </div>

        <nav className="header-nav">
          {NAVIGATION_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            const label = t(item.labelKey);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onTabChange?.(item.id)}
                className={`nav-tab-btn ${isActive ? 'nav-tab-btn-active' : ''}`}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                  {resolveNavIcon(item.id)}
                </span>
                <span>{label}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => {
              window.location.hash = ROUTES.SYSTEM_CONSOLE;
            }}
            className="nav-tab-btn nav-tab-btn-console"
            title="Open Infrastructure Control Plane"
          >
            <Terminal size={15} />
            <span>{t('header.systemConsole')}</span>
          </button>

          {/* Language Switch Button */}
          <button
            type="button"
            onClick={toggleLocale}
            className="nav-tab-btn"
            title={t('header.languageToggle')}
            style={{ padding: '0.4rem 0.65rem', minWidth: 'unset' }}
          >
            <Globe size={14} />
            <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>{locale}</span>
          </button>
        </nav>
      </div>
    </header>
  );
};

import React from 'react';
import { APP_NAME, NAVIGATION_ITEMS, type NavigationTabId } from '../constants/index';

interface HeaderProps {
  activeTab?: NavigationTabId;
  onTabChange?: (tab: NavigationTabId) => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab = 'home', onTabChange }) => {
  return (
    <header className="glass header-root">
      <div className="header-content">
        <div
          onClick={() => onTabChange?.('home')}
          className="header-brand"
        >
          <div className="header-logo-badge">
            C
          </div>
          <span className="gradient-text header-brand-name">
            {APP_NAME}
          </span>
        </div>

        <nav className="header-nav">
          {NAVIGATION_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange?.(item.id)}
                className={`nav-tab-btn ${isActive ? 'nav-tab-btn-active' : ''}`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => {
              window.location.hash = '#system-console';
            }}
            className="nav-tab-btn"
            style={{
              background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.15), rgba(79, 70, 229, 0.25))',
              border: '1px solid rgba(59, 130, 246, 0.4)',
              color: '#93c5fd',
              fontWeight: 600,
            }}
            title="Open Infrastructure Control Plane"
          >
            <span>⚡</span>
            <span>System Console</span>
          </button>
        </nav>
      </div>
    </header>
  );
};

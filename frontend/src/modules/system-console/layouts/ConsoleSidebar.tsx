import React from 'react';
import type { ConsoleSectionId } from '../types/console.types';
import { CONSOLE_NAV_ITEMS } from '../constants/console.constants';
import { useConsoleData } from '../context/console-data-context';
import { ConsoleIcon } from '../components/common/ConsoleIcon';
import { useLocale } from '../../../core/i18n/index';
import { Server, ArrowLeft } from 'lucide-react';

interface ConsoleSidebarProps {
  currentSection: ConsoleSectionId;
  onSelectSection: (section: ConsoleSectionId) => void;
}

export const ConsoleSidebar: React.FC<ConsoleSidebarProps> = ({
  currentSection,
  onSelectSection,
}) => {
  const { packages, health } = useConsoleData();
  const { t } = useLocale();

  // Categorize nav items into groups for professional organization
  const coreNav = CONSOLE_NAV_ITEMS.filter((item) =>
    ['overview', 'runtime', 'packages', 'logs'].includes(item.id),
  );
  const infraNav = CONSOLE_NAV_ITEMS.filter((item) =>
    ['database', 'cache', 'worker', 'scheduler'].includes(item.id),
  );
  const secNav = CONSOLE_NAV_ITEMS.filter((item) => ['security'].includes(item.id));

  const getBadge = (id: ConsoleSectionId) => {
    if (id === 'packages') return packages.length;
    if (id === 'runtime') return 4;
    return undefined;
  };

  const handleReturnHome = () => {
    window.location.hash = '';
  };

  const isApiOk = health.status === 'ok';

  return (
    <aside className="console-sidebar">
      {/* Brand Header */}
      <div className="sidebar-header">
        <div className="brand-title">
          <div className="brand-logo-badge" aria-hidden="true">
            <Server size={18} />
          </div>
          <div className="brand-meta">
            <span className="brand-name">{t('nav.systemConsole')}</span>
            <span className="brand-subtitle">Control Plane v1.0</span>
          </div>
        </div>
      </div>

      {/* Navigation Groups */}
      <nav className="sidebar-nav">
        <div className="nav-group-label">{t('healthMap.runtimes')}</div>
        {coreNav.map((item) => {
          const isActive = currentSection === item.id;
          const badge = getBadge(item.id);
          const label = t(`nav.${item.id}`);
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-item-btn ${isActive ? 'active' : ''}`}
              onClick={() => onSelectSection(item.id)}
            >
              <span className="nav-item-icon">
                <ConsoleIcon name={item.id} size={17} />
              </span>
              <span className="nav-item-text">{label}</span>
              {badge !== undefined && <span className="nav-item-badge">{badge}</span>}
            </button>
          );
        })}

        <div className="nav-group-label">{t('healthMap.infrastructure')}</div>
        {infraNav.map((item) => {
          const isActive = currentSection === item.id;
          const label = t(`nav.${item.id}`);
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-item-btn ${isActive ? 'active' : ''}`}
              onClick={() => onSelectSection(item.id)}
            >
              <span className="nav-item-icon">
                <ConsoleIcon name={item.id} size={17} />
              </span>
              <span className="nav-item-text">{label}</span>
            </button>
          );
        })}

        <div className="nav-group-label">{t('healthMap.governance')}</div>
        {secNav.map((item) => {
          const isActive = currentSection === item.id;
          const label = t(`nav.${item.id}`);
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-item-btn ${isActive ? 'active' : ''}`}
              onClick={() => onSelectSection(item.id)}
            >
              <span className="nav-item-icon">
                <ConsoleIcon name={item.id} size={17} />
              </span>
              <span className="nav-item-text">{label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer Return Home */}
      <div className="sidebar-footer">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 0.25rem 0.5rem',
            fontSize: '0.75rem',
            color: 'var(--scp-text-muted)',
          }}
        >
          <span>{t('healthMap.apiGateway')}</span>
          <span
            style={{
              color: isApiOk ? 'var(--scp-success-text)' : 'var(--scp-danger-text)',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: isApiOk ? 'var(--scp-success)' : 'var(--scp-danger)',
                display: 'inline-block',
              }}
            />
            {t(`console.healthStatus.${health.status}`).toUpperCase()}
          </span>
        </div>

        <button
          type="button"
          className="return-home-btn"
          onClick={handleReturnHome}
          title={t('nav.backToHome')}
        >
          <ArrowLeft size={14} />
          <span>{t('nav.backToHome')}</span>
        </button>
      </div>
    </aside>
  );
};

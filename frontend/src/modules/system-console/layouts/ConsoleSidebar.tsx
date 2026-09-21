import React from 'react';
import type { ConsoleSectionId } from '../types/console.types';
import { CONSOLE_NAV_ITEMS } from '../constants/console.constants';
import { useConsoleData } from '../context/ConsoleDataContext';

interface ConsoleSidebarProps {
  currentSection: ConsoleSectionId;
  onSelectSection: (section: ConsoleSectionId) => void;
}

export const ConsoleSidebar: React.FC<ConsoleSidebarProps> = ({
  currentSection,
  onSelectSection,
}) => {
  const { packages, health } = useConsoleData();

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

  return (
    <aside className="console-sidebar">
      {/* Brand Header */}
      <div className="sidebar-header">
        <div className="brand-title">
          <div className="brand-logo-badge">C</div>
          <div className="brand-meta">
            <span className="brand-name">System Console</span>
            <span className="brand-subtitle">Control Plane v1.0</span>
          </div>
        </div>
      </div>

      {/* Navigation Groups */}
      <nav className="sidebar-nav">
        <div className="nav-group-label">Core Monitoring</div>
        {coreNav.map((item) => {
          const isActive = currentSection === item.id;
          const badge = getBadge(item.id);
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-item-btn ${isActive ? 'active' : ''}`}
              onClick={() => onSelectSection(item.id)}
            >
              <span className="nav-item-icon">{item.icon}</span>
              <span className="nav-item-text">{item.label}</span>
              {badge !== undefined && <span className="nav-item-badge">{badge}</span>}
            </button>
          );
        })}

        <div className="nav-group-label">Infrastructure & Queues</div>
        {infraNav.map((item) => {
          const isActive = currentSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-item-btn ${isActive ? 'active' : ''}`}
              onClick={() => onSelectSection(item.id)}
            >
              <span className="nav-item-icon">{item.icon}</span>
              <span className="nav-item-text">{item.label}</span>
            </button>
          );
        })}

        <div className="nav-group-label">Governance</div>
        {secNav.map((item) => {
          const isActive = currentSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-item-btn ${isActive ? 'active' : ''}`}
              onClick={() => onSelectSection(item.id)}
            >
              <span className="nav-item-icon">{item.icon}</span>
              <span className="nav-item-text">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer Return Home */}
      <div className="sidebar-footer">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0.25rem 0.5rem', fontSize: '0.75rem', color: 'var(--scp-text-muted)' }}>
          <span>API Gateway</span>
          <span style={{ color: health.status === 'ok' ? 'var(--scp-success)' : 'var(--scp-danger)', fontWeight: 600 }}>
            ● {health.status.toUpperCase()}
          </span>
        </div>
        <button type="button" className="return-home-btn" onClick={handleReturnHome}>
          <span>←</span> Back to Application
        </button>
      </div>
    </aside>
  );
};

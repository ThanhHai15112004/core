import React from 'react';
import type { ConsoleSectionId, RefreshIntervalMs } from '../types/console.types';
import { CONSOLE_NAV_ITEMS, REFRESH_OPTIONS } from '../constants/console.constants';
import { useConsoleTheme } from '../context/ConsoleThemeContext';
import { useConsoleData } from '../context/ConsoleDataContext';

interface ConsoleTopBarProps {
  currentSection: ConsoleSectionId;
}

export const ConsoleTopBar: React.FC<ConsoleTopBarProps> = ({ currentSection }) => {
  const { theme, toggleTheme } = useConsoleTheme();
  const {
    refresh,
    isRefreshing,
    refreshInterval,
    setRefreshInterval,
    currentLatency,
  } = useConsoleData();

  const activeNavItem = CONSOLE_NAV_ITEMS.find((item) => item.id === currentSection);

  const getLatencyColor = (ms: number) => {
    if (ms < 30) return 'var(--scp-success)';
    if (ms < 80) return 'var(--scp-warning)';
    return 'var(--scp-danger)';
  };

  return (
    <header className="console-topbar">
      {/* Left: Breadcrumb */}
      <div className="topbar-left">
        <div className="breadcrumb-area">
          <span className="breadcrumb-parent">Control Plane</span>
          <span className="breadcrumb-separator">/</span>
          <span className="breadcrumb-current">
            {activeNavItem?.icon} {activeNavItem?.label || currentSection}
          </span>
        </div>
      </div>

      {/* Right: Controls & Actions */}
      <div className="topbar-right">
        {/* Latency Indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            padding: '0.3rem 0.6rem',
            borderRadius: '6px',
            backgroundColor: 'var(--scp-bg-surface-subtle)',
            border: '1px solid var(--scp-border-subtle)',
            fontSize: '0.75rem',
            fontWeight: 600,
          }}
          title="Roundtrip API latency to /health"
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: getLatencyColor(currentLatency),
            }}
          />
          <span style={{ color: 'var(--scp-text-secondary)' }}>{currentLatency} ms</span>
        </div>

        {/* Polling Interval Select */}
        <select
          className="control-select"
          value={refreshInterval}
          onChange={(e) => setRefreshInterval(Number(e.target.value) as RefreshIntervalMs)}
          title="Auto-refresh interval"
        >
          {REFRESH_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              Auto: {opt.label}
            </option>
          ))}
        </select>

        {/* Manual Refresh Button */}
        <button
          type="button"
          className="control-btn"
          onClick={() => refresh()}
          disabled={isRefreshing}
          title="Refresh live metrics now"
        >
          <span style={{ display: 'inline-block', transform: isRefreshing ? 'rotate(360deg)' : 'none', transition: 'transform 0.5s ease' }}>
            🔄
          </span>
          <span>{isRefreshing ? 'Syncing...' : 'Refresh'}</span>
        </button>

        {/* Theme Toggle Button */}
        <button
          type="button"
          className="control-btn"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
        >
          <span>{theme === 'light' ? '🌙 Dark' : '☀️ Light'}</span>
        </button>
      </div>
    </header>
  );
};

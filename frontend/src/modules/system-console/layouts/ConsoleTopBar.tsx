import React from 'react';
import type { ConsoleSectionId, RefreshIntervalMs } from '../types/console.types';
import { REFRESH_OPTIONS } from '../constants/console.constants';
import { useConsoleTheme } from '../context/console-theme-context';
import { useConsoleData } from '../context/console-data-context';
import { ConsoleIcon } from '../components/common/ConsoleIcon';
import { useLocale } from '../../../core/i18n/index';
import { RefreshCw, Moon, Sun, Globe } from 'lucide-react';

interface ConsoleTopBarProps {
  currentSection: ConsoleSectionId;
}

export const ConsoleTopBar: React.FC<ConsoleTopBarProps> = ({ currentSection }) => {
  const { theme, toggleTheme } = useConsoleTheme();
  const { locale, toggleLocale, t } = useLocale();
  const {
    refresh,
    isRefreshing,
    refreshInterval,
    setRefreshInterval,
    currentLatency,
  } = useConsoleData();

  const sectionLabel = t(`nav.${currentSection}`);

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
          <span className="breadcrumb-parent">{t('nav.systemConsole')}</span>
          <span className="breadcrumb-separator">/</span>
          <span className="breadcrumb-current" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <ConsoleIcon name={currentSection} size={15} />
            <span>{sectionLabel}</span>
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
            gap: '0.45rem',
            padding: '0.3rem 0.65rem',
            borderRadius: '6px',
            backgroundColor: 'var(--scp-bg-surface-subtle)',
            border: '1px solid var(--scp-border-subtle)',
            fontSize: '0.75rem',
            fontWeight: 600,
          }}
          title={t('console.topbar.latency')}
        >
          <span
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: getLatencyColor(currentLatency),
              display: 'inline-block',
            }}
          />
          <span style={{ color: 'var(--scp-text-secondary)' }}>{currentLatency} ms</span>
        </div>

        {/* Polling Interval Select */}
        <select
          className="control-select"
          value={refreshInterval}
          onChange={(e) => setRefreshInterval(Number(e.target.value) as RefreshIntervalMs)}
          title={t('console.topbar.refreshInterval')}
        >
          {REFRESH_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.value === 0 ? t('common.off') : `${t('common.autoRefresh')}: ${opt.value / 1000}s`}
            </option>
          ))}
        </select>

        {/* Manual Refresh Button */}
        <button
          type="button"
          className="control-btn"
          onClick={() => refresh()}
          disabled={isRefreshing}
          title={t('console.topbar.refreshNow')}
        >
          <RefreshCw
            size={13}
            style={{
              animation: isRefreshing ? 'spin 1s linear infinite' : 'none',
              transition: 'transform 0.3s ease',
            }}
          />
          <span>{isRefreshing ? t('common.refreshing') : t('common.refresh')}</span>
        </button>

        {/* Language Switch Button */}
        <button
          type="button"
          className="control-btn"
          onClick={toggleLocale}
          title={t('header.languageToggle')}
        >
          <Globe size={13} />
          <span style={{ textTransform: 'uppercase', fontWeight: 600 }}>{locale}</span>
        </button>

        {/* Theme Toggle Button */}
        <button
          type="button"
          className="control-btn"
          onClick={toggleTheme}
          title={t('header.themeToggle')}
        >
          {theme === 'light' ? <Moon size={14} /> : <Sun size={14} />}
          <span>{theme === 'light' ? t('console.topbar.dark') : t('console.topbar.light')}</span>
        </button>
      </div>
    </header>
  );
};

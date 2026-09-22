import React from 'react';
import { Globe, Moon, Sun } from 'lucide-react';
import type { ConsoleSectionId } from '../types/console.types';
import { useConsoleTheme } from '../context/console-theme-context';
import { useConsoleData } from '../context/console-data-context';
import { ConsoleIcon } from '../components/common/ConsoleIcon';
import { EnvironmentBadge } from '../components/common/EnvironmentBadge';
import { useLocale } from '../../../core/i18n/index';

interface ConsoleTopBarProps {
  currentSection: ConsoleSectionId;
}

const LATENCY_WARN_MS = 150;
const LATENCY_CRIT_MS = 500;

export const ConsoleTopBar: React.FC<ConsoleTopBarProps> = ({ currentSection }) => {
  const { theme, toggleTheme } = useConsoleTheme();
  const { locale, toggleLocale, t } = useLocale();
  const { currentLatency, isOffline, environment } = useConsoleData();

  const latencyTone = isOffline
    ? 'crit'
    : currentLatency >= LATENCY_CRIT_MS
      ? 'crit'
      : currentLatency >= LATENCY_WARN_MS
        ? 'warn'
        : 'ok';

  return (
    <header className="console-topbar">
      <nav className="tb-breadcrumb" aria-label="breadcrumb">
        <span className="tb-crumb-root">System Console</span>
        <span className="tb-crumb-sep">/</span>
        <span className="tb-crumb-current">
          <ConsoleIcon name={currentSection} size={14} />
          {t(`nav.${currentSection}`)}
        </span>
      </nav>

      <div className="tb-actions">
        {/* Overview đã có badge lớn ở header trang */}
        {currentSection !== 'overview' && <EnvironmentBadge environment={environment} size="sm" />}

        <span className={`tb-pill ov-tone-${latencyTone}`} title={t('console.topbar.latency')}>
          <span className="ov-dot" aria-hidden="true" />
          {isOffline ? t('console.healthStatus.down') : `${currentLatency} ms`}
        </span>


        <button type="button" className="tb-btn" onClick={toggleLocale} title={t('header.languageToggle')}>
          <Globe size={14} />
          <span>{locale.toUpperCase()}</span>
        </button>

        <button
          type="button"
          className="tb-btn tb-btn-icon"
          onClick={toggleTheme}
          title={theme === 'light' ? t('console.topbar.dark') : t('console.topbar.light')}
          aria-label={t('header.themeToggle')}
        >
          {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
        </button>
      </div>
    </header>
  );
};

import React, { useMemo } from 'react';
import { Server, ArrowLeft } from 'lucide-react';
import type { ConsoleSectionId } from '../types/console.types';
import { useConsoleData } from '../context/console-data-context';
import { ConsoleIcon } from '../components/common/ConsoleIcon';
import { worstTone, type StatusTone } from '../utils/status-tone';
import { useLocale } from '../../../core/i18n/index';

interface ConsoleSidebarProps {
  currentSection: ConsoleSectionId;
  onSelectSection: (section: ConsoleSectionId) => void;
}

const NAV_GROUPS: Array<{ id: string; items: ConsoleSectionId[] }> = [
  { id: 'monitor', items: ['overview', 'runtime', 'logs', 'packages'] },
  { id: 'infra', items: ['database', 'cache', 'worker', 'scheduler'] },
  { id: 'governance', items: ['security'] },
];

export const ConsoleSidebar: React.FC<ConsoleSidebarProps> = ({ currentSection, onSelectSection }) => {
  const { t } = useLocale();
  const { overviewData, packages, health, currentLatency, isOffline } = useConsoleData();

  /* Chấm trạng thái của mỗi mục = trạng thái tệ nhất của các thành phần trỏ về section đó. */
  const sectionTone = useMemo(() => {
    const map = new Map<ConsoleSectionId, StatusTone>();
    for (const section of NAV_GROUPS.flatMap((g) => g.items)) {
      const tone = worstTone(overviewData.healthMap.filter((i) => i.targetSection === section).map((i) => i.status));
      if (tone && tone !== 'unknown') map.set(section, tone);
    }
    return map;
  }, [overviewData.healthMap]);

  const problemPackages = packages.filter((p) => p.statusReport.status === 'warning' || p.statusReport.status === 'error').length;
  const apiTone: StatusTone = isOffline ? 'crit' : health.status === 'ok' ? 'ok' : 'warn';

  return (
    <aside className="console-sidebar">
      <div className="sb-brand">
        <span className="sb-brand-logo" aria-hidden="true">
          <Server size={17} />
        </span>
        <span className="sb-brand-text">
          <span className="sb-brand-name">System Console</span>
          <span className="sb-brand-sub">{t('ov.sidebar.subtitle')}</span>
        </span>
      </div>

      <nav className="sb-nav" aria-label={t('nav.systemConsole')}>
        {NAV_GROUPS.map((group) => (
          <div key={group.id} className="sb-group">
            <div className="sb-group-label">{t(`ov.sidebar.group.${group.id}`)}</div>
            {group.items.map((id) => {
              const tone = sectionTone.get(id);
              const isActive = currentSection === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={`sb-item ${isActive ? 'is-active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => onSelectSection(id)}
                >
                  <ConsoleIcon name={id} size={16} />
                  <span className="sb-item-label">{t(`nav.${id}`)}</span>
                  {id === 'packages' && problemPackages > 0 && (
                    <span className="sb-item-count" title={t('ov.sidebar.problemPackages')}>
                      {problemPackages}
                    </span>
                  )}
                  {tone && tone !== 'ok' && <span className={`sb-item-dot ov-tone-${tone}`} aria-label={t(`ov.tone.${tone}`)} />}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="sb-footer">
        <div className={`sb-api ov-tone-${apiTone}`}>
          <span className="ov-dot" aria-hidden="true" />
          <span className="sb-api-label">{t('healthMap.apiGateway')}</span>
          <span className="sb-api-value">
            {isOffline ? t('console.healthStatus.down') : `${currentLatency} ms`}
          </span>
        </div>
        <button type="button" className="sb-home" onClick={() => (window.location.hash = '')}>
          <ArrowLeft size={14} />
          <span>{t('nav.backToHome')}</span>
        </button>
      </div>
    </aside>
  );
};

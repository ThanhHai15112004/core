import React, { useMemo, useState } from 'react';
import { Server, ArrowLeft, ChevronRight } from 'lucide-react';
import type { ConsolePath, ConsoleSectionId } from '../types/console.types';
import { CONSOLE_STORAGE_KEYS } from '../constants/console.constants';
import { NAV_ROOT, NAV_TREE, groupOf, type NavLeaf } from '../constants/console-nav';
import { useConsoleData } from '../context/console-data-context';
import { ConsoleIcon } from '../components/common/ConsoleIcon';
import { worstTone, type StatusTone } from '../utils/status-tone';
import { useLocale } from '../../../core/i18n/index';

interface ConsoleSidebarProps {
  currentSection: ConsoleSectionId;
  onNavigate: (path: ConsolePath) => void;
}

function readCollapsed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CONSOLE_STORAGE_KEYS.NAV_COLLAPSED) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export const ConsoleSidebar: React.FC<ConsoleSidebarProps> = ({ currentSection, onNavigate }) => {
  const { t } = useLocale();
  const { overviewData, packages, health, currentLatency, isOffline } = useConsoleData();
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);
  const activeGroup = groupOf(currentSection)?.id;

  /* Chấm trạng thái = tông tệ nhất của các thành phần trỏ về section (theo segment đầu của targetSection). */
  const sectionTone = useMemo(() => {
    const map = new Map<string, StatusTone>();
    for (const item of overviewData.healthMap) {
      const section = item.targetSection.split(/[/?]/)[0] ?? '';
      const tone = worstTone([...(map.has(section) ? [map.get(section)!] : []), item.status]);
      if (tone) map.set(section, tone);
    }
    return map;
  }, [overviewData.healthMap]);

  const toggleGroup = (id: string) => {
    setCollapsed((prev) => {
      const next = prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id];
      try {
        localStorage.setItem(CONSOLE_STORAGE_KEYS.NAV_COLLAPSED, JSON.stringify(next));
      } catch {
        // Ignore
      }
      return next;
    });
  };

  const problemPackages = packages.filter(
    (p) => p.statusReport.status === 'warning' || p.statusReport.status === 'error',
  ).length;
  const apiTone: StatusTone = isOffline ? 'crit' : health.status === 'ok' ? 'ok' : 'warn';

  const renderLeaf = (leaf: NavLeaf, nested: boolean) => {
    const isActive = currentSection === leaf.id;
    const tone = sectionTone.get(leaf.id);
    return (
      <button
        key={leaf.id}
        type="button"
        className={`sb-item ${nested ? 'is-nested' : ''} ${isActive ? 'is-active' : ''} ${leaf.status === 'planned' ? 'is-planned' : ''}`}
        aria-current={isActive ? 'page' : undefined}
        onClick={() => onNavigate(leaf.id)}
      >
        {!nested && <ConsoleIcon name={leaf.id} size={16} />}
        <span className="sb-item-label">{t(`nav.${leaf.id}`)}</span>
        {leaf.status === 'planned' && <span className="sb-item-planned">{t('planned.badge')}</span>}
        {leaf.id === 'packages' && problemPackages > 0 && (
          <span className="sb-item-count" title={t('ov.sidebar.problemPackages')}>
            {problemPackages}
          </span>
        )}
        {tone && tone !== 'ok' && tone !== 'unknown' && (
          <span className={`sb-item-dot ov-tone-${tone}`} aria-label={t(`ov.tone.${tone}`)} />
        )}
      </button>
    );
  };

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
        <div className="sb-group">{renderLeaf(NAV_ROOT, false)}</div>

        {NAV_TREE.map((group, index) => {
          // Nhóm chứa tab đang mở luôn được mở ra.
          const isOpen = group.id === activeGroup || !collapsed.includes(group.id);
          const groupTone = worstTone(
            group.children.map((c) => sectionTone.get(c.id)).filter((x): x is StatusTone => Boolean(x)),
          );
          return (
            <div key={group.id} className="sb-group">
              <button
                type="button"
                className="sb-group-toggle"
                aria-expanded={isOpen}
                onClick={() => toggleGroup(group.id)}
              >
                <ConsoleIcon name={group.icon} size={16} />
                <span className="sb-item-label">
                  {index + 2}. {t(`nav.group.${group.id}`)}
                </span>
                {!isOpen && groupTone && groupTone !== 'ok' && groupTone !== 'unknown' && (
                  <span className={`sb-item-dot ov-tone-${groupTone}`} />
                )}
                <ChevronRight size={14} className={`sb-chevron ${isOpen ? 'is-open' : ''}`} />
              </button>
              {/* Luôn render để mobile (nav ngang, không có nút nhóm) vẫn thấy đủ mục. */}
              <div className={`sb-children ${isOpen ? '' : 'is-collapsed'}`}>
                {group.children.map((leaf) => renderLeaf(leaf, true))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="sb-footer">
        <div className={`sb-api ov-tone-${apiTone}`}>
          <span className="ov-dot" aria-hidden="true" />
          <span className="sb-api-label">{t('healthMap.apiGateway')}</span>
          <span className="sb-api-value">{isOffline ? t('console.healthStatus.down') : `${currentLatency} ms`}</span>
        </div>
        <button type="button" className="sb-home" onClick={() => (window.location.hash = '')}>
          <ArrowLeft size={14} />
          <span>{t('nav.backToHome')}</span>
        </button>
      </div>
    </aside>
  );
};

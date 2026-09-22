import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { ConsoleSectionId, InfraSnapshotItem } from '../../types/console.types';
import { ConsoleIcon } from '../common/ConsoleIcon';
import { useLocale } from '../../../../core/i18n/index';

interface InfraSnapshotGridProps {
  snapshots: InfraSnapshotItem[];
  onNavigate: (section: ConsoleSectionId) => void;
}

/** Vùng ⑥: mỗi thành phần đang làm việc thế nào. */
export const InfraSnapshotGrid: React.FC<InfraSnapshotGridProps> = ({ snapshots, onNavigate }) => {
  const { t } = useLocale();
  if (snapshots.length === 0) return null;

  return (
    <section className="ov-card ov-section" aria-labelledby="ov-snap-title">
      <header className="ov-section-head">
        <h3 id="ov-snap-title">{t('snapshots.title')}</h3>
        <span className="ov-section-hint">{t('snapshots.subtitle')}</span>
      </header>

      <div className="ov-snap-grid">
        {snapshots.map((snap) => (
          <article key={snap.id} className={`ov-snap ${snap.unavailable ? 'is-unavailable' : ''}`}>
            <h4 className="ov-snap-title">
              <ConsoleIcon name={snap.icon} size={15} />
              {snap.title}
            </h4>
            {snap.unavailable ? (
              <p className="ov-snap-empty">{t('ov.snapshot.notMonitored')}</p>
            ) : (
              <dl className="ov-snap-metrics">
                {snap.metrics.map((m) => (
                  <div key={m.label} className={m.isWarn ? 'is-warn' : ''}>
                    <dt>{m.label}</dt>
                    <dd>{m.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <button type="button" className="ov-link" onClick={() => onNavigate(snap.targetSection)}>
              {t('common.viewDetails')} <ArrowRight size={13} />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
};

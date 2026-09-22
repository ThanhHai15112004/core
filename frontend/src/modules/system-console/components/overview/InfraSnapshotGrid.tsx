import React from 'react';
import type { ConsoleSectionId, InfraSnapshotItem } from '../../types/console.types';

import { useLocale } from '../../../../core/i18n/index';
import { ConsoleIcon } from '../common/ConsoleIcon';
import { Activity } from 'lucide-react';

interface InfraSnapshotGridProps {
  snapshots: InfraSnapshotItem[];
  onNavigate: (section: ConsoleSectionId) => void;
}

export const InfraSnapshotGrid: React.FC<InfraSnapshotGridProps> = ({
  snapshots,
  onNavigate,
}) => {
  const { t } = useLocale();

  return (
    <section className="infra-snapshot-panel" aria-label={t('snapshots.title')}>
      <div className="infra-snapshot-header">
        <h3 className="infra-snapshot-title">
          <Activity size={17} style={{ color: 'var(--scp-primary)' }} />
          <span>{t('snapshots.title')}</span>
        </h3>
        <span style={{ fontSize: '0.75rem', color: 'var(--scp-text-muted)' }}>
          {t('snapshots.subtitle')}
        </span>
      </div>

      <div className="infra-snapshot-grid">
        {snapshots.map((item) => (
          <div key={item.id} className="snapshot-card">
            <div>
              <h4 className="snapshot-card-title">
                <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                  <ConsoleIcon name={item.targetSection} size={16} />
                </span>
                <span>{item.title}</span>
              </h4>

              <div className="snapshot-metric-list" style={{ marginTop: '0.75rem' }}>
                {item.metrics.map((m, idx) => (
                  <div key={idx} className="snapshot-metric-row">
                    <span className="snapshot-metric-label">{m.label}</span>
                    <span className={`snapshot-metric-val ${m.isWarn ? 'is-warn' : ''}`}>
                      {m.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ paddingTop: '0.5rem', borderTop: '1px solid var(--scp-border-subtle)' }}>
              <button
                type="button"
                className="snapshot-card-link"
                onClick={() => onNavigate(item.targetSection)}
              >
                {t('common.viewDetails')} →
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

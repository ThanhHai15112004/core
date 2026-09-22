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

  const getSnapshotTitle = (item: InfraSnapshotItem) => {
    switch (item.targetSection) {
      case 'runtime':
        return t('snapshots.api');
      case 'worker':
        return t('snapshots.worker');
      case 'database':
        return t('snapshots.database');
      case 'cache':
        return t('snapshots.cache');
      case 'scheduler':
        return t('snapshots.scheduler');
      default:
        return item.title;
    }
  };

  const getMetricLabel = (label: string) => {
    const l = label.toLowerCase();
    if (l.includes('port')) return t('snapshots.port');
    if (l.includes('heap used')) return t('snapshots.heapUsed');
    if (l.includes('heap total')) return t('snapshots.heapTotal');
    if (l.includes('driver')) return t('snapshots.driver');
    if (l.includes('pool')) return t('snapshots.poolMax');
    if (l.includes('latency') || l.includes('ping')) return t('snapshots.pingLatency');
    if (l.includes('synchronize') || l.includes('sync')) return t('snapshots.sync');
    if (l.includes('host')) return t('snapshots.host');
    if (l.includes('prefix')) return t('snapshots.prefix');
    if (l.includes('concurrency')) return t('snapshots.concurrency');
    if (l.includes('retry')) return t('snapshots.retryStrategy');
    if (l.includes('dead letter')) return t('snapshots.deadLetter');
    if (l.includes('timezone')) return t('snapshots.timezone');
    if (l.includes('state') || l.includes('status')) return t('snapshots.state');
    return label;
  };

  return (
    <section className="infra-snapshot-panel" aria-label="Runtime and Infrastructure Snapshot">
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
                <span>{getSnapshotTitle(item)}</span>
              </h4>

              <div className="snapshot-metric-list" style={{ marginTop: '0.75rem' }}>
                {item.metrics.map((m, idx) => (
                  <div key={idx} className="snapshot-metric-row">
                    <span className="snapshot-metric-label">{getMetricLabel(m.label)}</span>
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

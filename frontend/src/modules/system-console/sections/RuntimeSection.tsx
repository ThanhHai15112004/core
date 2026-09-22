import React from 'react';
import { useConsoleData } from '../context/console-data-context';
import { SectionHeader } from '../components/common/SectionHeader';
import { StatusPill } from '../components/common/StatusPill';
import { UptimeCounter } from '../components/common/UptimeCounter';
import { useLocale } from '../../../core/i18n/index';

type RuntimeId = 'api' | 'worker' | 'scheduler' | 'cli';

interface RuntimeRow {
  label: string;
  value: React.ReactNode;
}

const RUNTIMES: RuntimeId[] = ['api', 'worker', 'scheduler', 'cli'];

export const RuntimeSection: React.FC = () => {
  const { t } = useLocale();
  const { health, isOffline, overviewData } = useConsoleData();
  const info = overviewData.systemInfo;

  /* Chỉ API có số đo thật (qua /health và /ops/overview); các runtime khác chạy tiến trình riêng. */
  const apiRows: RuntimeRow[] = info
    ? [
        { label: t('console.runtime.nodeVersion'), value: info.nodeVersion },
        { label: t('console.runtime.platform'), value: `${info.platform} / ${info.arch}` },
        { label: t('console.runtime.pid'), value: info.pid },
        { label: t('console.runtime.heap'), value: `${info.heapUsedMb} / ${info.heapTotalMb} MB` },
        { label: t('console.runtime.rss'), value: `${info.rssMb} MB` },
        { label: t('console.runtime.uptime'), value: <UptimeCounter uptimeSeconds={health.uptime} /> },
      ]
    : [];

  return (
    <div>
      <SectionHeader title={t('console.runtime.title')} description={t('console.runtime.description')} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '1.25rem' }}>
        {RUNTIMES.map((id) => {
          const isApi = id === 'api';
          const status = isApi ? (isOffline ? 'down' : health.status === 'ok' ? 'healthy' : health.status) : 'unknown';
          const rows = isApi ? apiRows : [];

          return (
            <div key={id} className="scp-panel" style={{ display: 'flex', flexDirection: 'column', margin: 0 }}>
              <div className="scp-panel-header">
                <div>
                  <h3 className="scp-panel-title">{t(`console.runtime.${id}.name`)}</h3>
                  <span style={{ fontSize: '0.75rem', fontFamily: 'monospace', color: 'var(--scp-text-muted)' }}>
                    backend/src/apps/{id}/
                  </span>
                </div>
                <StatusPill status={status} />
              </div>

              <p style={{ fontSize: '0.825rem', color: 'var(--scp-text-secondary)', lineHeight: 1.5, margin: '0 0 1rem' }}>
                {t(`console.runtime.${id}.description`)}
              </p>

              {rows.length > 0 ? (
                <div className="scp-table-wrap">
                  <table className="scp-table">
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.label}>
                          <td className="cell-muted" style={{ width: '45%' }}>{row.label}</td>
                          <td className="cell-strong">{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="scp-alert scp-alert-info" style={{ margin: 0 }}>
                  {isApi ? t('console.fallback.noData') : t('console.runtime.notMonitored')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

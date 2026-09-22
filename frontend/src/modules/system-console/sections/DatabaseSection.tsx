import React, { useState } from 'react';
import { Database, Server, Layers, Activity, Sliders, AlertTriangle } from 'lucide-react';
import { useConsoleData } from '../context/console-data-context';
import { SectionHeader } from '../components/common/SectionHeader';
import { StatusPill } from '../components/common/StatusPill';
import { StatCard } from '../components/common/StatCard';
import { Sparkline } from '../components/common/Sparkline';
import { usePackage } from '../hooks/usePackage';
import { useLocale } from '../../../core/i18n/index';

const NO_VALUE = '--';
const PING_ACTION = 'ping';
const MAX_PING_HISTORY = 16;

export const DatabaseSection: React.FC = () => {
  const { t } = useLocale();
  const { executeAction } = useConsoleData();
  const { pkg, metric } = usePackage('database');

  const [pingHistory, setPingHistory] = useState<number[]>([]);
  const [isPinging, setIsPinging] = useState(false);
  const [lastPingMessage, setLastPingMessage] = useState<string | null>(null);

  const driver = String(metric('driver') ?? NO_VALUE);
  const host = metric('host');
  const port = metric('port');
  const endpoint = host !== undefined ? `${host}:${port ?? ''}` : NO_VALUE;
  const database = String(metric('database') ?? NO_VALUE);
  const poolLimit = metric('poolLimit');
  const synchronize = metric('synchronize') === true;
  const isConnected = metric('isConnected');

  const lastPing = pingHistory[pingHistory.length - 1];
  const avgPing = pingHistory.length
    ? Math.round(pingHistory.reduce((a, b) => a + b, 0) / pingHistory.length)
    : undefined;

  const handlePing = async () => {
    try {
      setIsPinging(true);
      const start = performance.now();
      const res = await executeAction('database', PING_ACTION);
      const latencyMs = Math.max(1, Math.round(performance.now() - start));
      if (res.success) setPingHistory((prev) => [...prev, latencyMs].slice(-MAX_PING_HISTORY));
      setLastPingMessage(t('console.database.pingResult', { message: res.message, ms: latencyMs }));
    } finally {
      setIsPinging(false);
    }
  };

  const configRows = [
    { key: 'driver', value: driver },
    { key: 'endpoint', value: endpoint },
    { key: 'database', value: database },
    { key: 'pool', value: poolLimit ?? NO_VALUE },
    { key: 'synchronize', value: String(synchronize) },
  ];

  return (
    <div>
      <SectionHeader
        title={t('console.database.title')}
        description={t('console.database.description')}
        actions={
          <button type="button" className="scp-btn scp-btn-secondary" onClick={handlePing} disabled={isPinging || !pkg}>
            {isPinging ? t('console.database.pinging') : t('console.database.ping')}
          </button>
        }
      />

      {synchronize && (
        <div className="scp-alert scp-alert-danger" role="alert">
          <strong style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <AlertTriangle size={16} />
            <span>{t('console.database.syncWarningTitle')}</span>
          </strong>
          <p style={{ margin: '0.25rem 0 0' }}>{t('console.database.syncWarningMessage')}</p>
        </div>
      )}

      <div className="overview-grid-4">
        <StatCard
          title={t('console.database.connection')}
          value={
            isConnected === undefined
              ? NO_VALUE
              : isConnected
                ? t('console.database.connected')
                : t('console.database.disconnected')
          }
          icon={<Database size={18} />}
          subtext={pkg && <StatusPill status={pkg.statusReport.status} />}
        />
        <StatCard title={t('console.database.driver')} value={driver} icon={<Server size={18} />} subtext={endpoint} />
        <StatCard title={t('console.database.pool')} value={poolLimit ?? NO_VALUE} icon={<Layers size={18} />} />
        <StatCard
          title={t('console.database.pingLatency')}
          value={lastPing !== undefined ? `${lastPing} ms` : NO_VALUE}
          icon={<Activity size={18} />}
          subtext={
            avgPing !== undefined
              ? t('console.database.pingAverage', { ms: avgPing })
              : t('console.database.pingHint')
          }
        >
          {pingHistory.length > 1 && <Sparkline data={pingHistory} height={28} />}
        </StatCard>
      </div>

      <div className="scp-panel">
        <div className="scp-panel-header">
          <h3 className="scp-panel-title">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <Sliders size={16} />
              <span>{t('console.database.configTitle')}</span>
            </span>
          </h3>
          {lastPingMessage && (
            <span style={{ fontSize: '0.8rem', color: 'var(--scp-text-secondary)', fontWeight: 600 }}>
              {lastPingMessage}
            </span>
          )}
        </div>

        <div className="scp-table-wrap">
          <table className="scp-table">
            <thead>
              <tr>
                <th>{t('console.database.configKey')}</th>
                <th>{t('console.database.configValue')}</th>
                <th>{t('console.database.configDescription')}</th>
              </tr>
            </thead>
            <tbody>
              {configRows.map((row) => (
                <tr key={row.key}>
                  <td className="cell-strong">{t(`console.database.config.${row.key}.label`)}</td>
                  <td>
                    <span className="code-badge">{row.value}</span>
                  </td>
                  <td className="cell-muted">{t(`console.database.config.${row.key}.description`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

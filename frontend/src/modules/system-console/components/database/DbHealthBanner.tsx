import React, { useState } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, HelpCircle, PlugZap, RefreshCw } from 'lucide-react';
import type { DbOverview, DbPing } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { HEALTH_TONE } from '../../constants/database';
import { formatDuration } from '../../utils/database-format';
import { useLocale } from '../../../../core/i18n/index';

const ICONS = { healthy: CheckCircle2, degraded: AlertTriangle, reconnecting: RefreshCw, unavailable: AlertOctagon, unknown: HelpCircle, disabled: HelpCircle } as const;

/** Trạng thái database + lý do + Test Connection (kết quả latency/lỗi thật). */
export const DbHealthBanner: React.FC<{ data: DbOverview; now: number }> = ({ data, now }) => {
  const { t, formatRelative, formatTime } = useLocale();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<DbPing | null>(null);
  const { health, server } = data;
  const Icon = ICONS[health.status];
  const product = server.available ? `${server.data.product} ${server.data.version}` : data.driver;

  const test = async () => {
    setTesting(true);
    try {
      setResult(await databaseApi.ping());
    } catch (err) {
      setResult({ ok: false, latencyMs: null, error: { code: null, message: err instanceof Error ? err.message : String(err) }, checkedAt: new Date().toISOString(), state: 'unknown' });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className={`pf-status db-health ov-tone-${HEALTH_TONE[health.status]}`} role="status">
      <Icon size={22} className="pf-status-icon" />
      <div className="db-health-body">
        <strong>{t(`db.health.${health.status}`)}</strong>
        <span className="db-health-meta">
          {product} · {data.database} · {['production', 'staging', 'development'].includes(data.environment) ? t(`ov.env.${data.environment}`) : data.environment}
          {health.pingMs !== null && ` · ping ${formatDuration(health.pingMs)}`}
        </span>
        {health.reasons.length > 0 && (
          <ul className="db-health-reasons">
            {health.reasons.map((r) => (
              <li key={`${r.code}-${r.message}`}>{r.message}</li>
            ))}
          </ul>
        )}
        {health.status !== 'healthy' && health.lastSuccessAt && (
          <p className="db-health-last">{t('db.health.lastSuccess', { time: formatRelative(new Date(health.lastSuccessAt), now) })}</p>
        )}
      </div>
      <div className="db-health-test">
        <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => void test()} disabled={testing}>
          <PlugZap size={13} /> {testing ? t('db.test.running') : t('db.test.button')}
        </button>
        {result && (
          <span className={`db-test-result ${result.ok ? 'is-ok' : 'is-fail'}`}>
            {result.ok
              ? t('db.test.ok', { latency: formatDuration(result.latencyMs), time: formatTime(Date.parse(result.checkedAt), true) })
              : t('db.test.fail', { error: `${result.error?.code ?? ''} ${result.error?.message ?? ''}`.trim() })}
          </span>
        )}
      </div>
    </section>
  );
};

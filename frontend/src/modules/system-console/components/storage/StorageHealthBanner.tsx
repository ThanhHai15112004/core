import React, { useState } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, HelpCircle, PlugZap, RefreshCw, XCircle } from 'lucide-react';
import type { StorageOverview, StorageTest } from '../../types/storage.types';
import { storageApi } from '../../services/storage.api';
import { STORAGE_HEALTH_TONE } from '../../constants/storage';
import { formatDuration } from '../../utils/database-format';
import { useLocale } from '../../../../core/i18n/index';

const ICONS = { healthy: CheckCircle2, degraded: AlertTriangle, reconnecting: RefreshCw, unavailable: AlertOctagon, unknown: HelpCircle } as const;

/** Trạng thái storage + lý do + Test Storage (connect → write → read → verify → delete, từng bước có thời gian). */
export const StorageHealthBanner: React.FC<{ data: StorageOverview; now: number; onTested: () => void }> = ({ data, now, onTested }) => {
  const { t, formatRelative, formatTime } = useLocale();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<StorageTest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { health, provider } = data;
  const Icon = ICONS[health.status];
  const env = ['production', 'staging', 'development'].includes(data.environment) ? t(`ov.env.${data.environment}`) : data.environment;

  const test = async () => {
    setTesting(true);
    setError(null);
    try {
      setResult(await storageApi.test());
      onTested();
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className={`pf-status db-health ov-tone-${STORAGE_HEALTH_TONE[health.status]}`} role="status">
      <Icon size={22} className="pf-status-icon" />
      <div className="db-health-body">
        <strong>{t(`storage.health.${health.status}`)}</strong>
        <span className="db-health-meta">
          {provider.product} · {env} · <code>{provider.location}</code>
          {health.pingMs !== null && ` · ping ${formatDuration(health.pingMs)}`}
          {' · '}
          {t('cache.health.checked', { time: formatTime(Date.parse(data.generatedAt), true) })}
        </span>
        {health.reasons.length > 0 && (
          <ul className="db-health-reasons">
            {health.reasons.map((r) => (
              <li key={`${r.code}-${r.message}`}>{r.message}</li>
            ))}
          </ul>
        )}
        {health.status !== 'healthy' && health.lastSuccessAt && (
          <p className="db-health-last">{t('storage.health.lastSuccess', { time: formatRelative(new Date(health.lastSuccessAt), now) })}</p>
        )}
      </div>
      <div className="db-health-test st-test">
        <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => void test()} disabled={testing}>
          <PlugZap size={13} /> {testing ? t('db.test.running') : t('storage.test.button')}
        </button>
        {error && <span className="db-test-result is-fail">{error}</span>}
        {result && (
          <div className={`st-test-result ${result.ok ? 'is-ok' : 'is-fail'}`}>
            <strong>
              {result.ok ? t('storage.test.ok', { ms: result.totalMs }) : t('storage.test.fail', { step: t(`storage.test.step.${result.failedStep}`) })}
            </strong>
            <ul>
              {result.steps.map((s) => (
                <li key={s.step} className={s.ok ? 'is-ok' : 'is-fail'}>
                  {s.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                  <span>{t(`storage.test.step.${s.step}`)}</span>
                  <span>{s.ms === null ? '' : formatDuration(s.ms)}</span>
                  {s.error && <small>{s.error}</small>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
};

import React, { useState } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, HelpCircle, PlugZap, RefreshCw } from 'lucide-react';
import type { CacheOverview, CachePing } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import { CACHE_HEALTH_TONE } from '../../constants/cache';
import { formatDuration } from '../../utils/database-format';
import { useLocale } from '../../../../core/i18n/index';

const ICONS = { healthy: CheckCircle2, degraded: AlertTriangle, reconnecting: RefreshCw, unavailable: AlertOctagon, unknown: HelpCircle } as const;

/** Trạng thái cache + lý do + Test Connection (PING thật). Không đưa host/port/prefix lên đây — xem tab Cấu hình. */
export const CacheHealthBanner: React.FC<{ data: CacheOverview; now: number }> = ({ data, now }) => {
  const { t, formatRelative, formatTime } = useLocale();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<CachePing | null>(null);
  const { health } = data;
  const Icon = ICONS[health.status];
  const env = ['production', 'staging', 'development'].includes(data.environment) ? t(`ov.env.${data.environment}`) : data.environment;

  const test = async () => {
    setTesting(true);
    try {
      setResult(await cacheApi.ping());
    } catch (err) {
      setResult({ ok: false, latencyMs: null, error: err instanceof Error ? err.message : String(err), state: 'unknown', at: new Date().toISOString() });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className={`pf-status db-health ov-tone-${CACHE_HEALTH_TONE[health.status]}`} role="status">
      <Icon size={22} className="pf-status-icon" />
      <div className="db-health-body">
        <strong>{t(`cache.health.${health.status}`)}</strong>
        <span className="db-health-meta">
          {t(`cache.driver.${data.driver}`)} · {env}
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
          <p className="db-health-last">{t('cache.health.lastSuccess', { time: formatRelative(new Date(health.lastSuccessAt), now) })}</p>
        )}
      </div>
      <div className="db-health-test">
        <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => void test()} disabled={testing}>
          <PlugZap size={13} /> {testing ? t('db.test.running') : t('db.test.button')}
        </button>
        {result && (
          <span className={`db-test-result ${result.ok ? 'is-ok' : 'is-fail'}`}>
            {result.ok
              ? t('db.test.ok', { latency: formatDuration(result.latencyMs), time: formatTime(Date.parse(result.at), true) })
              : t('db.test.fail', { error: result.error ?? '' })}
          </span>
        )}
      </div>
    </section>
  );
};

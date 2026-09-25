import React, { useState } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, FileText, HelpCircle, PlugZap, RefreshCw, XCircle } from 'lucide-react';
import type { MessagingOverview, MessagingTest } from '../../types/messaging.types';
import { messagingApi } from '../../services/messaging.api';
import { MESSAGING_HEALTH_TONE } from '../../constants/messaging';
import { formatDuration } from '../../utils/database-format';
import { useLocale } from '../../../../core/i18n/index';

const ICONS = { healthy: CheckCircle2, degraded: AlertTriangle, reconnecting: RefreshCw, unavailable: AlertOctagon, unknown: HelpCircle } as const;

/**
 * Trạng thái messaging + lý do + Test Broker (connect → publish → consume → ack qua queue healthcheck riêng,
 * không đụng message nghiệp vụ; từng bước có thời gian, lỗi thì chỉ rõ bước).
 */
export const MessagingHealthBanner: React.FC<{ data: MessagingOverview; now: number; onTested: () => void; onOpenLogs: () => void }> = ({
  data,
  now,
  onTested,
  onOpenLogs,
}) => {
  const { t, formatRelative, formatTime } = useLocale();
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<MessagingTest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { health, provider } = data;
  const Icon = ICONS[health.status];
  const env = ['production', 'staging', 'development'].includes(data.environment) ? t(`ov.env.${data.environment}`) : data.environment;

  const test = async () => {
    setTesting(true);
    setError(null);
    try {
      setResult(await messagingApi.test());
      onTested();
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className={`pf-status db-health ov-tone-${MESSAGING_HEALTH_TONE[health.status]}`} role="status">
      <Icon size={22} className="pf-status-icon" />
      <div className="db-health-body">
        <strong>{t(`messaging.health.${health.status}`)}</strong>
        <span className="db-health-meta">
          {provider.product} ({provider.broker}) · {env} · <code>{provider.endpoint}</code>
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
        {health.status !== 'healthy' && (
          <p className="db-health-last">
            {health.lastPublishAt && t('messaging.health.lastPublish', { time: formatRelative(new Date(health.lastPublishAt), now) })}
            {health.lastPublishAt && health.lastSuccessAt && ' · '}
            {health.lastSuccessAt && t('messaging.health.lastSuccess', { time: formatRelative(new Date(health.lastSuccessAt), now) })}
            {health.state !== 'connected' && health.failures > 0 && ` · ${t('messaging.health.attempts', { count: health.failures })}`}
          </p>
        )}
      </div>
      <div className="db-health-test st-test">
        <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => void test()} disabled={testing}>
          <PlugZap size={13} /> {testing ? t('db.test.running') : t('messaging.test.button')}
        </button>
        {error && <span className="db-test-result is-fail">{error}</span>}
        {result && (
          <div className={`st-test-result ${result.ok ? 'is-ok' : 'is-fail'}`}>
            <strong>
              {result.ok
                ? t('messaging.test.ok', { ms: result.roundTripMs ?? result.totalMs })
                : t('messaging.test.fail', { step: t(`messaging.test.step.${result.failedStep}`) })}
            </strong>
            <ul>
              {result.steps.map((s) => (
                <li key={s.step} className={s.ok ? 'is-ok' : 'is-fail'}>
                  {s.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                  <span>{t(`messaging.test.step.${s.step}`)}</span>
                  <span>{s.ms === null ? '' : formatDuration(s.ms)}</span>
                  {s.error && <small>{s.error}</small>}
                </li>
              ))}
            </ul>
            {!result.ok && (
              <button type="button" className="ov-link" onClick={onOpenLogs}>
                <FileText size={12} /> {t('db.query.openLogs')}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

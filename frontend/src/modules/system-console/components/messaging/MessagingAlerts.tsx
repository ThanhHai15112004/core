import React from 'react';
import { ArrowRight, CheckCircle2, Info } from 'lucide-react';
import type { MessagingOverview, MessagingTab } from '../../types/messaging.types';
import { useLocale } from '../../../../core/i18n/index';

/** Vấn đề hiện tại + các kiểm tra đang ổn (broker, consumer, lag, dead letter). */
export const MessagingAlerts: React.FC<{ data: MessagingOverview; now: number; onOpen: (tab: MessagingTab) => void }> = ({ data, now, onOpen }) => {
  const { t, formatRelative } = useLocale();
  const rules = new Set(data.alerts.map((a) => a.rule));
  const ok: string[] = [];
  if (data.health.state === 'connected') ok.push(t('messaging.alerts.connected'));
  if (data.queues.available && !rules.has('NO_CONSUMER') && !rules.has('CONSUMER_PAUSED')) ok.push(t('messaging.alerts.consumersOk'));
  if (data.kpis.lag !== null && !rules.has('LAG_HIGH') && !rules.has('LAG_GROWING')) ok.push(t('messaging.alerts.lagOk'));
  if (data.kpis.deadLetter === 0) ok.push(t('messaging.alerts.noDeadLetter'));
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('messaging.alerts.title')}</h3>
        {data.alerts.length > 0 && <span className="ov-count">{data.alerts.length}</span>}
      </header>
      <ul className="db-alerts">
        {data.alerts.map((a) => (
          <li key={a.id} className={`ov-tone-${a.severity === 'critical' ? 'crit' : a.severity === 'warning' ? 'warn' : 'unknown'}`}>
            {a.severity === 'info' ? <Info size={14} /> : <span className="ov-dot" aria-hidden="true" />}
            <span className="db-alert-body">
              <strong>
                {a.title}
                {a.target && (
                  <>
                    {' '}
                    · <code>{a.target}</code>
                  </>
                )}
              </strong>
              <span>{a.message}</span>
              <small>{t('db.alerts.since', { time: formatRelative(new Date(a.since), now) })}</small>
            </span>
            <button type="button" className="ov-link" onClick={() => onOpen(a.tab)}>
              {t('db.alerts.inspect')} <ArrowRight size={12} />
            </button>
          </li>
        ))}
        {data.alerts.length === 0 && ok.length === 0 && <li className="ov-empty-line">{t('messaging.alerts.none')}</li>}
        {ok.map((line) => (
          <li key={line} className="ov-tone-ok is-ok">
            <CheckCircle2 size={14} />
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};

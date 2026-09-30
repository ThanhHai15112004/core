import React from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import type { WorkerAlert, WorkerOverview } from '../../types/worker.types';
import { useLocale } from '../../../../core/i18n/index';

/** Vấn đề hiện tại (bấm → đúng queue/worker/tab) + các kiểm tra đang ổn. */
export const WorkerAlerts: React.FC<{ alerts: WorkerAlert[]; data?: WorkerOverview; now: number; onOpen: (alert: WorkerAlert) => void; title?: string }> = ({
  alerts,
  data,
  now,
  onOpen,
  title,
}) => {
  const { t, formatRelative } = useLocale();
  const rules = new Set(alerts.map((a) => a.rule));
  const ok: string[] = [];
  if (data) {
    if (data.health.state === 'connected') ok.push(t('wq.alerts.connected'));
    if (data.kpis.workers > 0 && !rules.has('NO_WORKER')) ok.push(t('wq.alerts.workersOk', { count: data.kpis.workers }));
    if (data.queues.available && !rules.has('BACKLOG') && !rules.has('OLDEST_WAITING')) ok.push(t('wq.alerts.backlogOk'));
    if (data.failures.stalled === 0) ok.push(t('wq.alerts.noStalled'));
  }
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{title ?? t('wq.alerts.title')}</h3>
        {alerts.length > 0 && <span className="ov-count">{alerts.length}</span>}
      </header>
      <ul className="db-alerts">
        {alerts.map((a) => (
          <li key={a.id} className={`ov-tone-${a.severity === 'critical' ? 'crit' : a.severity === 'warning' ? 'warn' : 'unknown'}`}>
            <span className="ov-dot" aria-hidden="true" />
            <span className="db-alert-body">
              <strong>
                <span className="wq-sev">{t(`wq.severity.${a.severity}`)}</span> {a.title}
                {a.queue && (
                  <>
                    {' '}
                    · <code>{a.queue}</code>
                  </>
                )}
              </strong>
              <span>{a.message}</span>
              <small>{t('db.alerts.since', { time: formatRelative(new Date(a.since), now) })}</small>
            </span>
            <button type="button" className="ov-link" onClick={() => onOpen(a)}>
              {t('db.alerts.inspect')} <ArrowRight size={12} />
            </button>
          </li>
        ))}
        {alerts.length === 0 && ok.length === 0 && <li className="ov-empty-line">{t('wq.alerts.none')}</li>}
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

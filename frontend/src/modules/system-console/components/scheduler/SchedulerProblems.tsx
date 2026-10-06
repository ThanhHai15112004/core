import React from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import type { SchedulerAlert, SchedulerOverview } from '../../types/scheduler.types';
import { useLocale } from '../../../../core/i18n/index';

/** Current Problems: cảnh báo đang diễn ra (bấm → task / tab) + các kiểm tra đang ổn. */
export const SchedulerProblems: React.FC<{ alerts: SchedulerAlert[]; data?: SchedulerOverview; now: number; onOpen: (a: SchedulerAlert) => void; title?: string }> = ({
  alerts,
  data,
  now,
  onOpen,
  title,
}) => {
  const { t, formatRelative } = useLocale();
  const rules = new Set(alerts.map((a) => a.rule));
  const ok: string[] = [];
  if (data && data.instance && !rules.has('CONSECUTIVE_FAILURES')) ok.push(t('sch.problems.noFailures'));
  const allGood = data && alerts.length === 0 && data.health.status === 'healthy';
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{title ?? t('sch.problems.title')}</h3>
        {alerts.length > 0 && <span className="ov-count">{alerts.length}</span>}
      </header>
      {allGood && (
        <p className="msg-status-line ov-tone-ok">
          <CheckCircle2 size={14} /> <strong>{t('sch.problems.allGood')}</strong> <span>{t('sch.problems.allGoodHint')}</span>
        </p>
      )}
      <ul className="db-alerts">
        {alerts.map((a) => (
          <li key={a.id} className={`ov-tone-${a.severity === 'critical' ? 'crit' : a.severity === 'warning' ? 'warn' : 'unknown'}`}>
            <span className="ov-dot" aria-hidden="true" />
            <span className="db-alert-body">
              <strong>
                <span className="wq-sev">{t(`wq.severity.${a.severity}`)}</span> {a.title}
              </strong>
              <span>{a.message}</span>
              <small>{t('db.alerts.since', { time: formatRelative(new Date(a.since), now) })}</small>
            </span>
            <button type="button" className="ov-link" onClick={() => onOpen(a)}>
              {t('db.alerts.inspect')} <ArrowRight size={12} />
            </button>
          </li>
        ))}
        {!allGood &&
          ok.map((line) => (
            <li key={line} className="ov-tone-ok is-ok">
              <CheckCircle2 size={14} />
              <span>{line}</span>
            </li>
          ))}
        {!data && alerts.length === 0 && <li className="ov-empty-line">{t('sch.problems.none')}</li>}
      </ul>
    </section>
  );
};

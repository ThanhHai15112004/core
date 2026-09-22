import React from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import type { DbOverview, DbTab } from '../../types/database.types';
import { useLocale } from '../../../../core/i18n/index';

/** Vấn đề hiện tại: cảnh báo đang diễn ra + các kiểm tra đang ổn (deadlock, lock, kết nối). */
export const DbAlerts: React.FC<{ data: DbOverview; now: number; onOpen: (tab: DbTab) => void }> = ({ data, now, onOpen }) => {
  const { t, formatRelative } = useLocale();
  const ok: string[] = [];
  const rules = new Set(data.alerts.map((a) => a.rule));
  if (data.kpis.deadlocks24h === 0) ok.push(t('db.alerts.noDeadlocks'));
  if (data.kpis.lockWaits === 0 && !rules.has('LOCK_WAITS')) ok.push(t('db.alerts.noLocks'));
  if (data.health.status === 'healthy' || data.health.status === 'degraded') ok.push(t('db.alerts.connected'));
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('db.alerts.title')}</h3>
        {data.alerts.length > 0 && <span className="ov-count">{data.alerts.length}</span>}
      </header>
      <ul className="db-alerts">
        {data.alerts.map((a) => (
          <li key={a.id} className={`ov-tone-${a.severity === 'critical' ? 'crit' : 'warn'}`}>
            <span className="ov-dot" aria-hidden="true" />
            <span className="db-alert-body">
              <strong>{a.title}</strong>
              <span>{a.message}</span>
              {a.since && <small>{t('db.alerts.since', { time: formatRelative(new Date(a.since), now) })}</small>}
            </span>
            <button type="button" className="ov-link" onClick={() => onOpen(a.tab)}>
              {t('db.alerts.inspect')} <ArrowRight size={12} />
            </button>
          </li>
        ))}
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

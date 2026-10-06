import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { SchedulerOverview } from '../../types/scheduler.types';
import { formatUptime, NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** Scheduler Runtime: process tự báo heartbeat (host, pid, uptime). Lịch nằm trên BullMQ Job Scheduler. CPU/RAM → Runtimes. */
export const RuntimePanel: React.FC<{ data: SchedulerOverview; onInspect: () => void }> = ({ data, onInspect }) => {
  const { t } = useLocale();
  const i = data.instance;
  const alive = i !== null && data.health.status !== 'down';
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('sch.runtime.title')}</h3>
        <button type="button" className="ov-link" onClick={onInspect}>
          {t('sch.health.inspectRuntime')} <ArrowRight size={13} />
        </button>
      </header>
      <dl className="db-stat-grid db-stat-compact">
        <div>
          <dt>{t('sch.runtime.instances')}</dt>
          <dd className={alive ? '' : 'is-warn'}>{alive ? 1 : 0}</dd>
        </div>
        <div>
          <dt>{t('sch.runtime.uptime')}</dt>
          <dd>{i ? formatUptime(i.uptimeSec) : NO_VALUE}</dd>
        </div>
        <div>
          <dt>{t('sch.runtime.lock')}</dt>
          <dd>BullMQ Job Scheduler</dd>
        </div>
      </dl>
      {i && (
        <ul className="cache-key-list">
          <li className={alive ? '' : 'is-muted'}>
            <span>
              <span className={`ov-dot ov-tone-${!alive ? 'crit' : i.paused ? 'unknown' : 'ok'}`} aria-hidden="true" /> <code>{i.instance}</code>
              {i.paused && ` · ${t('sch.runtime.paused')}`}
            </span>
            <span>
              {alive
                ? t('sch.runtime.instanceMeta', { uptime: formatUptime(i.uptimeSec), age: i.heartbeatAgeSec, running: data.kpis.running })
                : t('sch.runtime.instanceGone', { age: formatUptime(i.heartbeatAgeSec) })}
            </span>
          </li>
        </ul>
      )}
      <p className="pf-chart-note">{t('sch.runtime.note')}</p>
    </section>
  );
};

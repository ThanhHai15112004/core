import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { SchedulerOverview } from '../../types/scheduler.types';
import { formatUptime, NO_VALUE } from '../../utils/runtime-format';
import { formatMs } from '../../utils/worker-format';
import { useLocale } from '../../../../core/i18n/index';

/** Scheduler Runtime: instance (tự báo heartbeat), chiến lược chạy nhiều instance, độ trễ bắt đầu. CPU/RAM → Runtimes. */
export const RuntimePanel: React.FC<{ data: SchedulerOverview; onInspect: () => void }> = ({ data, onInspect }) => {
  const { t } = useLocale();
  const alive = data.runtime.instances.filter((i) => i.alive);
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
          <dd className={alive.length === 0 ? 'is-warn' : ''}>{alive.length}</dd>
        </div>
        <div>
          <dt>{t('sch.runtime.state')}</dt>
          <dd>{data.runtime.runtimeState ? t(`sch.runtime.stateOf.${data.runtime.runtimeState}`) : NO_VALUE}</dd>
        </div>
        <div>
          <dt>{t('sch.runtime.uptime')}</dt>
          <dd>{data.runtime.uptimeSec === null ? NO_VALUE : formatUptime(data.runtime.uptimeSec)}</dd>
        </div>
        <div>
          <dt>{t('sch.runtime.driftAvg')}</dt>
          <dd>{formatMs(data.drift.avgMs)}</dd>
        </div>
        <div>
          <dt>{t('sch.runtime.driftP95')}</dt>
          <dd className={data.alerts.some((a) => a.rule === 'HIGH_DRIFT') ? 'is-warn' : ''}>{formatMs(data.drift.p95Ms)}</dd>
        </div>
        <div>
          <dt>{t('sch.runtime.lock')}</dt>
          <dd>{data.runtime.lockProvider}</dd>
        </div>
      </dl>
      {data.runtime.instances.length > 0 && (
        <ul className="cache-key-list">
          {data.runtime.instances.map((i) => (
            <li key={i.instance} className={i.alive ? '' : 'is-muted'}>
              <span>
                <span className={`ov-dot ov-tone-${!i.alive ? 'crit' : i.paused ? 'unknown' : 'ok'}`} aria-hidden="true" /> <code>{i.instance}</code>
                {i.paused && ` · ${t('sch.runtime.paused')}`}
              </span>
              <span>
                {i.alive
                  ? t('sch.runtime.instanceMeta', { uptime: formatUptime(i.uptimeSec), age: i.heartbeatAgeSec, running: i.running })
                  : t('sch.runtime.instanceGone', { age: formatUptime(i.heartbeatAgeSec) })}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="pf-chart-note">{t('sch.runtime.note')}</p>
    </section>
  );
};

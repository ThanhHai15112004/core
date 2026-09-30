import React from 'react';
import { ArrowRight, CalendarClock } from 'lucide-react';
import type { Execution, SchedulerAlert, SchedulerEvent, SchedulerOverview, SchedulerRange, SchedulerReport, SchedulerTab, TaskRow } from '../../types/scheduler.types';
import type { TaskAction } from '../../hooks/useSchedulerActions';
import { SchedulerKpis } from '../../components/scheduler/SchedulerKpis';
import { SchedulerChart } from '../../components/scheduler/SchedulerChart';
import { SchedulerProblems } from '../../components/scheduler/SchedulerProblems';
import { ConcentrationNotes, UpcomingList } from '../../components/scheduler/UpcomingList';
import { TaskTable } from '../../components/scheduler/TaskTable';
import { ExecutionTable } from '../../components/scheduler/ExecutionTable';
import { SchedulerEventList } from '../../components/scheduler/SchedulerEventList';
import { RuntimePanel } from '../../components/scheduler/RuntimePanel';
import { formatCompact } from '../../utils/database-format';
import { trendOf } from '../../utils/performance-format';
import { formatMs } from '../../utils/worker-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

interface Props {
  data: SchedulerOverview | null;
  range: SchedulerRange;
  paused: boolean;
  now: number;
  go: (tab: SchedulerTab) => void;
  openTask: (taskId: string) => void;
  openAlert: (a: SchedulerAlert) => void;
  openEvent: (e: SchedulerEvent) => void;
  openExecution: (e: Execution) => void;
  onAction: (action: TaskAction, task: TaskRow) => void;
  canRun: boolean;
  navigate: (path: string) => void;
}

const pct = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : ((a - b) / b) * 100);

/**
 * Monitor: KPI → Scheduler Activity → Current Problems + Upcoming → Tasks → lần chạy gần đây + runtime →
 * báo cáo hôm nay / hôm qua → sự kiện. Luồng: phát hiện vấn đề → Task → History → Execution Detail → Run Now / Disable.
 */
export const SchedulerOverviewView: React.FC<Props> = ({ data, paused, now, go, openTask, openAlert, openEvent, openExecution, onAction, canRun, navigate }) => {
  const { t, locale } = useLocale();
  if (!data) return <SchedulerKpis data={null} now={now} />;
  const n = (v: number | null) => (v === null ? NO_VALUE : formatCompact(v, locale));
  const noTasks = data.tasks.length === 0;
  const reportRow = (key: keyof SchedulerReport, fmt: (v: number | null) => string, higherIsWorse: boolean | null) => {
    const today = data.report.today[key];
    const yesterday = data.report.yesterday[key];
    const trend = trendOf(pct(today, yesterday), higherIsWorse);
    return (
      <tr key={key}>
        <th>{t(`sch.report.${key}`)}</th>
        <td>{fmt(today)}</td>
        <td>{fmt(yesterday)}</td>
        <td>{trend ? <span className={`ov-kpi-trend is-${trend.tone}`}>{trend.text}</span> : NO_VALUE}</td>
      </tr>
    );
  };
  return (
    <>
      <SchedulerKpis data={data} now={now} />

      {noTasks && (
        <section className="tr-empty-state" role="status">
          <CalendarClock size={28} />
          <h2>{t('sch.empty.title')}</h2>
          <p>{data.health.aliveInstances > 0 ? t('sch.empty.noTasks') : t('sch.empty.noRuntime')}</p>
        </section>
      )}

      <SchedulerChart range={data.range} paused={paused} />

      <div className="ov-split db-split-even">
        <SchedulerProblems alerts={data.alerts} data={data} now={now} onOpen={openAlert} />
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('sch.upcoming.title')}</h3>
            <button type="button" className="ov-link" onClick={() => go('timeline')}>
              {t('sch.upcoming.next24h')} <ArrowRight size={13} />
            </button>
          </header>
          <UpcomingList items={data.upcoming} now={now} onOpenTask={openTask} emptyText={t('sch.upcoming.empty')} />
          <ConcentrationNotes items={data.concentration} />
        </section>
      </div>

      {data.running.length > 0 && (
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('sch.running.title')}</h3>
            <span className="ov-count">{data.running.length}</span>
          </header>
          <ExecutionTable rows={data.running} columns={['time', 'task', 'result', 'duration', 'trigger', 'instance']} onOpen={openExecution} emptyText="" />
          <p className="pf-chart-note">{t('sch.running.note')}</p>
        </section>
      )}

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('sch.task.title')}</h3>
          <button type="button" className="ov-link" onClick={() => go('tasks')}>
            {t('sch.task.viewAll')} <ArrowRight size={13} />
          </button>
        </header>
        <TaskTable rows={data.tasks} now={now} onOpen={openTask} onAction={onAction} canRun={canRun} emptyText={t('sch.task.empty')} />
      </section>

      <div className="ov-split">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('sch.recent.title')}</h3>
            <button type="button" className="ov-link" onClick={() => go('history')}>
              {t('sch.recent.viewAll')} <ArrowRight size={13} />
            </button>
          </header>
          <ExecutionTable rows={data.recent} columns={['time', 'task', 'result', 'duration', 'trigger']} onOpen={openExecution} emptyText={t('sch.recent.empty')} />
        </section>
        <RuntimePanel data={data} onInspect={() => navigate('runtimes/scheduler')} />
      </div>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('sch.report.title')}</h3>
          <span className="ov-section-hint">{t('db.report.hint')}</span>
        </header>
        <div className="scp-table-wrap">
          <table className="scp-table tr-kv-table db-report">
            <thead>
              <tr>
                <th />
                <th>{t('db.report.today')}</th>
                <th>{t('db.report.yesterday')}</th>
                <th>{t('db.report.change')}</th>
              </tr>
            </thead>
            <tbody>
              {reportRow('executions', n, null)}
              {reportRow('successful', n, null)}
              {reportRow('failed', n, true)}
              {reportRow('skipped', n, true)}
              {reportRow('missed', n, true)}
              {reportRow('successRatePercent', (v) => (v === null ? NO_VALUE : `${v}%`), false)}
              {reportRow('avgDurationMs', formatMs, true)}
              {reportRow('p95DurationMs', formatMs, true)}
              {reportRow('manualRuns', n, null)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('sch.events.title')}</h3>
          <button type="button" className="ov-link" onClick={() => go('events')}>
            {t('db.events.viewAll')} <ArrowRight size={13} />
          </button>
        </header>
        <SchedulerEventList events={data.events} onOpen={openEvent} emptyText={t('sch.events.empty')} />
      </section>
    </>
  );
};

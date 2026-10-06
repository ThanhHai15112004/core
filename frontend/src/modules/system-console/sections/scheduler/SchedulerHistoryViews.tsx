import React, { useState } from 'react';
import type { Execution, ExecutionStatus, ExecutionTrigger, SchedulerAlert, SchedulerRange, TaskRow } from '../../types/scheduler.types';
import { schedulerApi } from '../../services/scheduler.api';
import { usePolling } from '../../hooks/usePolling';
import { ExecutionTable } from '../../components/scheduler/ExecutionTable';
import { SchedulerProblems } from '../../components/scheduler/SchedulerProblems';
import { ExecutionFilters } from './TaskDetailView';
import { formatCompact } from '../../utils/database-format';
import { useLocale } from '../../../../core/i18n/index';

interface ViewProps {
  range: SchedulerRange;
  paused: boolean;
  reloadKey: number;
  now: number;
}

/** Execution History: mọi lần chạy (lọc trạng thái / trigger / task) — nơi điều tra từng lần chạy. */
export const SchedulerHistoryView: React.FC<ViewProps & { tasks: TaskRow[]; openExecution: (e: Execution) => void }> = ({
  range,
  paused,
  reloadKey,
  tasks,
  openExecution,
}) => {
  const { t } = useLocale();
  const [statuses, setStatuses] = useState<ExecutionStatus[]>([]);
  const [triggers, setTriggers] = useState<ExecutionTrigger[]>([]);
  const [task, setTask] = useState('');
  const key = `sch-history:${range}:${task}:${statuses.join(',')}:${triggers.join(',')}:${reloadKey}`;
  const { data, error } = usePolling(
    () => schedulerApi.executions({ range, status: statuses, trigger: triggers, limit: 300, ...(task ? { task } : {}) }),
    key,
    10_000,
    paused,
  );
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('sch.history.title')}</h3>
        <div className="wq-chart-controls">
          {tasks.length > 1 && (
            <label className="wq-select">
              <span>{t('sch.exec.col.task')}</span>
              <select value={task} onChange={(e) => setTask(e.target.value)}>
                <option value="">{t('sch.history.allTasks')}</option>
                {tasks.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <ExecutionFilters statuses={statuses} triggers={triggers} setStatuses={setStatuses} setTriggers={setTriggers} />
        </div>
      </header>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {!data && !error && <p className="ov-empty-line">{t('common.loading')}</p>}
      {data && (
        <ExecutionTable
          rows={data.items}
          columns={['time', 'task', 'result', 'duration', 'trigger', 'id']}
          onOpen={openExecution}
          emptyText={t('sch.history.empty')}
        />
      )}
      {data?.truncated && <p className="pf-chart-note">{t('sch.history.truncated', { count: data.items.length })}</p>}
      <p className="pf-chart-note">{t('sch.history.note')}</p>
    </section>
  );
};

/** Failures: lỗi & lỡ lịch theo loại, theo task (lỗi liên tiếp trước), danh sách lần chạy lỗi. */
export const SchedulerFailuresView: React.FC<
  ViewProps & { openExecution: (e: Pick<Execution, 'id'>) => void; openTask: (taskId: string) => void; openAlert: (a: SchedulerAlert) => void }
> = ({ range, paused, reloadKey, now, openExecution, openTask, openAlert }) => {
  const { t, locale, formatRelative } = useLocale();
  const { data, error } = usePolling(() => schedulerApi.failures(range), `sch-failures:${range}:${reloadKey}`, 15_000, paused);
  const n = (v: number) => formatCompact(v, locale);
  if (error && !data) return <p className="scp-alert scp-alert-danger">{error.message}</p>;
  if (!data) return <p className="ov-empty-line">{t('common.loading')}</p>;
  return (
    <>
      <div className="ov-kpi-grid db-kpi-grid sch-kpi-4">
        <div className={`ov-card ov-kpi ov-tone-${data.failed > 0 ? 'warn' : 'ok'}`}>
          <span className="ov-kpi-label">{t('sch.failures.failed')}</span>
          <span className="ov-kpi-value">{n(data.failed)}</span>
          <span className="ov-kpi-sub">{t(`tr.range.${range}`)}</span>
        </div>
        <div className="ov-card ov-kpi">
          <span className="ov-kpi-label">{t('sch.failures.types')}</span>
          <span className="ov-kpi-value">{data.byType.length}</span>
          <span className="ov-kpi-sub">{data.byType[0]?.type ?? '—'}</span>
        </div>
        <div className={`ov-card ov-kpi ov-tone-${data.byTask.some((x) => x.consecutive > 0) ? 'warn' : 'ok'}`}>
          <span className="ov-kpi-label">{t('sch.failures.consecutiveTasks')}</span>
          <span className="ov-kpi-value">{data.byTask.filter((x) => x.consecutive > 0).length}</span>
          <span className="ov-kpi-sub">{t('sch.failures.consecutiveSub')}</span>
        </div>
      </div>

      {data.alerts.length > 0 && <SchedulerProblems alerts={data.alerts} now={now} onOpen={openAlert} title={t('sch.failures.alerts')} />}

      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('sch.failures.byType')}</h3>
          </header>
          {data.byType.length === 0 ? (
            <p className="ov-empty-line">{t('sch.failures.none')}</p>
          ) : (
            <div className="scp-table-wrap">
              <table className="scp-table">
                <thead>
                  <tr>
                    <th>{t('sch.failures.type')}</th>
                    <th>{t('sch.failures.count')}</th>
                    <th>{t('sch.failures.tasks')}</th>
                    <th>{t('sch.failures.last')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byType.map((x) => (
                    <tr key={x.type} className="is-clickable" onClick={() => openExecution({ id: x.sampleExecutionId })}>
                      <td>
                        <code>{x.type === 'MissedSchedule' ? t('sch.failures.missedType') : x.type}</code>
                      </td>
                      <td className="cell-strong">{n(x.count)}</td>
                      <td>{x.tasks.join(', ')}</td>
                      <td>{formatRelative(new Date(x.lastAt), now)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('sch.failures.byTask')}</h3>
          </header>
          {data.byTask.length === 0 ? (
            <p className="ov-empty-line">{t('sch.failures.none')}</p>
          ) : (
            <div className="scp-table-wrap">
              <table className="scp-table">
                <thead>
                  <tr>
                    <th>{t('sch.exec.col.task')}</th>
                    <th>{t('sch.failures.failed')}</th>
                    <th>{t('sch.failures.consecutive')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byTask.map((x) => (
                    <tr key={x.taskId} className="is-clickable" onClick={() => openTask(x.taskId)}>
                      <td className="cell-strong">{x.taskName}</td>
                      <td>{n(x.failed)}</td>
                      <td className={x.consecutive > 0 ? 'is-warn' : ''}>{x.consecutive}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="pf-chart-note">{t('sch.failures.consecutiveNote')}</p>
        </section>
      </div>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('sch.failures.list')}</h3>
          <span className="ov-section-hint">{t(`tr.range.${range}`)}</span>
        </header>
        <ExecutionTable rows={data.items} columns={['time', 'task', 'result', 'error', 'duration', 'trigger']} onOpen={openExecution} emptyText={t('sch.failures.none')} />
        {data.truncated && <p className="pf-chart-note">{t('sch.history.truncated', { count: data.items.length })}</p>}
        <p className="pf-chart-note">{t('sch.failures.note')}</p>
      </section>
    </>
  );
};

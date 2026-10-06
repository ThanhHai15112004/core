import React, { useState } from 'react';
import { AlertTriangle, ArrowLeft, FileText, Layers, Play, Power, PowerOff } from 'lucide-react';
import type { Execution, ExecutionStatus, ExecutionTrigger, SchedulerRange, TaskDetail, TaskDetailTab, TaskRow } from '../../types/scheduler.types';
import type { TaskAction } from '../../hooks/useSchedulerActions';
import { schedulerApi } from '../../services/scheduler.api';
import { usePolling } from '../../hooks/usePolling';
import { EXECUTION_ICON, EXECUTION_STATUSES, EXECUTION_TRIGGERS, TASK_DETAIL_TABS, TASK_STATUS_TONE } from '../../constants/scheduler';
import { LineChart } from '../../components/common/LineChart';
import { SchedulerChart } from '../../components/scheduler/SchedulerChart';
import { SchedulerProblems } from '../../components/scheduler/SchedulerProblems';
import { ExecutionTable } from '../../components/scheduler/ExecutionTable';
import { ExecutionStatusChip, ScheduleCell, TaskHealthDot, TaskStatusChip } from '../../components/scheduler/TaskStatus';
import { formatCompact } from '../../utils/database-format';
import { formatMs } from '../../utils/worker-format';
import { formatIn, formatInterval, secondsUntil } from '../../utils/scheduler-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

interface Props {
  taskId: string;
  sub: TaskDetailTab;
  range: SchedulerRange;
  paused: boolean;
  reloadKey: number;
  now: number;
  onSub: (sub: TaskDetailTab) => void;
  onBack: () => void;
  onAction: (action: TaskAction, task: TaskRow) => void;
  openExecution: (e: Pick<Execution, 'id'>) => void;
  navigate: (path: string) => void;
}

/**
 * Task Detail: trạng thái vận hành + sức khoẻ, lịch cho người đọc, Run Now / Enable / Disable; tab Overview | History |
 * Metrics | Logs | Configuration. Lịch khai báo trong code — Console không sửa lịch.
 */
export const TaskDetailView: React.FC<Props> = (props) => {
  const { taskId, sub, range, paused, reloadKey, now, onSub, onBack, onAction, openExecution, navigate } = props;
  const { t } = useLocale();
  const { data, error } = usePolling(() => schedulerApi.task(taskId, range), `sch-task:${taskId}:${range}:${reloadKey}`, 10_000, paused);
  const task = data?.task;

  const body = () => {
    if (!data || !task) return null;
    switch (sub) {
      case 'history':
        return <TaskHistoryPanel taskId={taskId} range={range} paused={paused} reloadKey={reloadKey} openExecution={openExecution} />;
      case 'metrics':
        return (
          <>
            <SchedulerChart range={range} paused={paused} task={taskId} initial="executions" />
            <SchedulerChart range={range} paused={paused} task={taskId} initial="duration" title={t('sch.detail.durationChart')} />
          </>
        );
      case 'logs':
        return <TaskLogsPanel data={data} navigate={navigate} openExecution={openExecution} />;
      case 'configuration':
        return <TaskConfigPanel data={data} />;
      default:
        return <TaskOverviewPanel data={data} now={now} openExecution={openExecution} navigate={navigate} onSub={onSub} />;
    }
  };

  return (
    <>
      <button type="button" className="ov-link wq-back" onClick={onBack}>
        <ArrowLeft size={13} /> {t('sch.detail.back')}
      </button>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {task && data && (
        <section className={`ov-card ov-section wq-detail-head ov-tone-${TASK_STATUS_TONE[task.status]}`}>
          <header className="ov-section-head">
            <div>
              <h2 className="wq-detail-title">
                {task.name} <code className="sch-task-id">{task.id}</code>
              </h2>
              <p className="msg-status-line">
                <TaskStatusChip task={task} />
                <TaskHealthDot task={task} />
                {task.status !== 'enabled' && task.status !== 'disabled' && (
                  <span className={`pf-chip ov-tone-${task.enabled ? 'ok' : 'unknown'}`}>{task.enabled ? t('sch.detail.enabled') : t('sch.detail.disabled')}</span>
                )}
              </p>
              <p className="sch-detail-schedule">
                <ScheduleCell schedule={task.schedule} showTz />
              </p>
              {task.description && <p className="pf-chart-note">{task.description}</p>}
            </div>
            <div className="cache-drawer-actions">
              {data.settings.run && (
                <button type="button" className="scp-btn scp-btn-sm scp-btn-primary" onClick={() => onAction('run', task)}>
                  <Play size={13} /> {t('sch.action.run')}
                </button>
              )}
              {data.settings.toggle &&
                (task.enabled ? (
                  <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => onAction('disable', task)}>
                    <PowerOff size={13} /> {t('sch.action.disable')}
                  </button>
                ) : (
                  <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => onAction('enable', task)}>
                    <Power size={13} /> {t('sch.action.enable')}
                  </button>
                ))}
            </div>
          </header>
        </section>
      )}
      {task && (
        <nav className="rt-tabs wq-subtabs" role="tablist" aria-label={task.name}>
          {TASK_DETAIL_TABS.map((x) => (
            <button key={x} type="button" role="tab" aria-selected={sub === x} className={sub === x ? 'is-active' : ''} onClick={() => onSub(x)}>
              {t(`sch.detail.tab.${x}`)}
            </button>
          ))}
        </nav>
      )}
      {body()}
    </>
  );
};

const TaskOverviewPanel: React.FC<{
  data: TaskDetail;
  now: number;
  openExecution: (e: Pick<Execution, 'id'>) => void;
  navigate: (path: string) => void;
  onSub: (sub: TaskDetailTab) => void;
}> = ({ data, now, openExecution, navigate, onSub }) => {
  const { t, locale, formatTime, formatRelative } = useLocale();
  const { task, kpis } = data;
  const n = (v: number) => formatCompact(v, locale);
  const lastStatus = task.lastStatus;
  const cards: { key: string; value: React.ReactNode; sub: string; tone: string }[] = [
    {
      key: 'successRate',
      value: kpis.successRatePercent === null ? NO_VALUE : `${kpis.successRatePercent}%`,
      sub: t('sch.detail.kpi.successSub', { ok: n(kpis.successful), total: n(kpis.executions) }),
      tone: kpis.successRatePercent === null ? 'unknown' : kpis.successRatePercent < 95 ? 'warn' : 'ok',
    },
    {
      key: 'lastRun',
      value: lastStatus ? `${EXECUTION_ICON[lastStatus]} ${t(`sch.exec.status.${lastStatus}`)}` : NO_VALUE,
      sub: task.lastRunAt ? formatRelative(new Date(task.lastRunAt), now) : t('sch.task.never'),
      tone: lastStatus === 'failed' ? 'crit' : lastStatus === 'success' ? 'ok' : 'unknown',
    },
    { key: 'avgDuration', value: formatMs(kpis.avgDurationMs), sub: t('sch.detail.kpi.sampled', { count: kpis.sampled }), tone: 'unknown' },
    {
      key: 'p95Duration',
      value: formatMs(kpis.p95DurationMs),
      sub: NO_VALUE,
      tone: 'unknown',
    },
    { key: 'nextRun', value: task.nextRunAt ? formatIn(secondsUntil(task.nextRunAt, now)) : NO_VALUE, sub: task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : t(`sch.task.status.${task.status}`), tone: 'unknown' },
    { key: 'failuresToday', value: n(kpis.failuresToday), sub: t('sch.detail.kpi.failedSub', { count: n(kpis.failed) }), tone: kpis.failuresToday > 0 ? 'warn' : 'ok' },
  ];
  const failures = data.durations.filter((d) => d.status === 'failed');
  return (
    <>
      <div className="ov-kpi-grid db-kpi-grid sch-kpi-6">
        {cards.map((c) => (
          <div key={c.key} className={`ov-card ov-kpi ov-tone-${c.tone}`}>
            <span className="ov-kpi-label">{t(`sch.detail.kpi.${c.key}`)}</span>
            <span className="ov-kpi-value">{c.value}</span>
            <span className="ov-kpi-sub">{c.sub}</span>
          </div>
        ))}
      </div>

      {data.consecutive && (
        <section className={`pf-status db-health ov-tone-${data.consecutive.count >= 2 ? 'warn' : 'unknown'}`} role="status">
          <AlertTriangle size={20} className="pf-status-icon" />
          <div className="db-health-body">
            <strong>{t('sch.detail.consecutive.title', { count: data.consecutive.count })}</strong>
            <span className="db-health-meta">
              {t('sch.detail.consecutive.lastSuccess', {
                time: data.consecutive.lastSuccessAt ? new Date(data.consecutive.lastSuccessAt).toLocaleString() : t('sch.task.never'),
              })}
              {data.consecutive.firstFailedAt && ` · ${t('sch.detail.consecutive.since', { time: new Date(data.consecutive.firstFailedAt).toLocaleString() })}`}
            </span>
            {task.lastError && (
              <p className="db-health-last">
                <code>{task.lastError.type}</code> {task.lastError.message}
              </p>
            )}
          </div>
          {task.lastExecutionId && (
            <div className="db-health-test">
              <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => openExecution({ id: task.lastExecutionId! })}>
                {t('sch.detail.consecutive.inspect')}
              </button>
            </div>
          )}
        </section>
      )}

      {data.running.length > 0 && (
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('sch.running.title')}</h3>
          </header>
          {data.running.map((r) => (
            <p key={r.id} className={`msg-status-line ov-tone-ok`}>
              <ExecutionStatusChip exec={r} />
              <span>
                {t('sch.detail.running.normal')} · {t('sch.detail.running.for', { duration: formatMs(r.runningMs) })}
                {r.startedAt && ` · ${t('sch.detail.running.started', { time: formatTime(Date.parse(r.startedAt), true) })}`}
              </span>
              <button type="button" className="ov-link" onClick={() => openExecution(r)}>
                {t('sch.detail.running.inspect')}
              </button>
            </p>
          ))}
        </section>
      )}

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('sch.detail.performance')}</h3>
          <span className="ov-section-hint">{t('sch.detail.performanceHint', { count: data.durations.length })}</span>
        </header>
        <LineChart
          series={[{ id: 'duration', label: t('sch.detail.duration'), color: 'var(--scp-series-1)', points: data.durations.map((d) => ({ t: d.t, value: d.durationMs })) }]}
          unit="ms"
          formatTime={(ts) => formatTime(ts, false)}
          emptyText={t('sch.detail.noDurations')}
          ariaLabel={t('sch.detail.performance')}
          markers={failures.map((f) => ({ t: f.t, label: t('sch.exec.status.failed'), color: 'var(--scp-danger)' }))}
        />
      </section>

      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('sch.detail.next')}</h3>
            <span className="ov-section-hint">{task.schedule.timezone}</span>
          </header>
          {data.next.length === 0 ? (
            <p className="ov-empty-line">{t(`sch.detail.noNext.${task.enabled ? 'enabled' : 'disabled'}`)}</p>
          ) : (
            <ol className="sch-cron-next">
              {data.next.map((at) => (
                <li key={at}>
                  {new Date(at).toLocaleDateString()} {formatTime(Date.parse(at), false)} <small className="pf-row-note">{formatIn(secondsUntil(at, now))}</small>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('sch.downstream.title')}</h3>
          </header>
          {!data.downstream ? (
            <p className="ov-empty-line">{t('sch.downstream.none')}</p>
          ) : data.downstream.state ? (
            <>
              <p className={`msg-status-line ov-tone-${data.downstream.state.waiting > 0 && data.downstream.state.workers === 0 ? 'crit' : data.downstream.state.failed > 0 ? 'warn' : 'ok'}`}>
                <code>{data.downstream.queue}</code>
                {data.downstream.state.paused && <span className="pf-chip ov-tone-unknown">{t('wq.queue.statusOf.paused')}</span>}
              </p>
              <dl className="db-stat-grid db-stat-compact">
                <div>
                  <dt>{t('wq.queue.waiting')}</dt>
                  <dd>{formatCompact(data.downstream.state.waiting, locale)}</dd>
                </div>
                <div>
                  <dt>{t('wq.queue.active')}</dt>
                  <dd>{formatCompact(data.downstream.state.active, locale)}</dd>
                </div>
                <div>
                  <dt>{t('wq.queue.failed')}</dt>
                  <dd className={data.downstream.state.failed > 0 ? 'is-warn' : ''}>{formatCompact(data.downstream.state.failed, locale)}</dd>
                </div>
                <div>
                  <dt>{t('sch.downstream.workers')}</dt>
                  <dd>{data.downstream.state.workers ?? NO_VALUE}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="ov-empty-line">
              <code>{data.downstream.queue}</code> · {data.downstream.reason}
            </p>
          )}
          {data.downstream && (
            <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate(`worker/queues/${encodeURIComponent(data.downstream!.queue)}`)}>
              <Layers size={13} /> {t('sch.downstream.open')}
            </button>
          )}
          <p className="pf-chart-note">{t('sch.downstream.note')}</p>
        </section>
      </div>

      {data.alerts.length > 0 && <SchedulerProblems alerts={data.alerts} now={now} onOpen={(a) => (a.executionId ? openExecution({ id: a.executionId }) : undefined)} />}

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('sch.recent.title')}</h3>
          <button type="button" className="ov-link" onClick={() => onSub('history')}>
            {t('sch.recent.viewAll')}
          </button>
        </header>
        <ExecutionTable rows={data.recent} columns={['time', 'result', 'duration', 'trigger']} onOpen={openExecution} emptyText={t('sch.recent.empty')} />
      </section>
    </>
  );
};

const TaskHistoryPanel: React.FC<{ taskId: string; range: SchedulerRange; paused: boolean; reloadKey: number; openExecution: (e: Execution) => void }> = ({
  taskId,
  range,
  paused,
  reloadKey,
  openExecution,
}) => {
  const { t } = useLocale();
  const [statuses, setStatuses] = useState<ExecutionStatus[]>([]);
  const [triggers, setTriggers] = useState<ExecutionTrigger[]>([]);
  const key = `sch-task-exec:${taskId}:${range}:${statuses.join(',')}:${triggers.join(',')}:${reloadKey}`;
  const { data, error } = usePolling(() => schedulerApi.executions({ range, task: taskId, status: statuses, trigger: triggers, limit: 200 }), key, 10_000, paused);
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('sch.history.title')}</h3>
        <ExecutionFilters statuses={statuses} triggers={triggers} setStatuses={setStatuses} setTriggers={setTriggers} />
      </header>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {data && (
        <ExecutionTable rows={data.items} columns={['time', 'result', 'duration', 'trigger', 'error']} onOpen={openExecution} emptyText={t('sch.history.empty')} />
      )}
      {data?.truncated && <p className="pf-chart-note">{t('sch.history.truncated', { count: data.items.length })}</p>}
    </section>
  );
};

/** Bộ lọc lịch sử: trạng thái (Success / Failed / Missed…) + trigger (Scheduled / Manual / Recovery). */
export const ExecutionFilters: React.FC<{
  statuses: ExecutionStatus[];
  triggers: ExecutionTrigger[];
  setStatuses: (v: ExecutionStatus[]) => void;
  setTriggers: (v: ExecutionTrigger[]) => void;
}> = ({ statuses, triggers, setStatuses, setTriggers }) => {
  const { t } = useLocale();
  const toggle = <T extends string>(list: T[], v: T, set: (x: T[]) => void) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="wq-state-filter" role="group" aria-label={t('sch.history.filter')}>
      {EXECUTION_STATUSES.map((s) => (
        <button key={s} type="button" aria-pressed={statuses.includes(s)} className={`pf-chip ${statuses.includes(s) ? 'is-active' : ''}`} onClick={() => toggle(statuses, s, setStatuses)}>
          {EXECUTION_ICON[s]} {t(`sch.exec.status.${s}`)}
        </button>
      ))}
      {EXECUTION_TRIGGERS.map((s) => (
        <button key={s} type="button" aria-pressed={triggers.includes(s)} className={`pf-chip ${triggers.includes(s) ? 'is-active' : ''}`} onClick={() => toggle(triggers, s, setTriggers)}>
          {t(`sch.exec.trigger.${s}`)}
        </button>
      ))}
    </div>
  );
};

const TaskLogsPanel: React.FC<{ data: TaskDetail; navigate: (path: string) => void; openExecution: (e: Execution) => void }> = ({ data, navigate, openExecution }) => {
  const { t, formatTime } = useLocale();
  const logsOf = (correlationId: string) => navigate(`logs/explorer?correlationId=${encodeURIComponent(correlationId)}`);
  const runs = data.recent.filter((r) => r.correlationId);
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('sch.logs.title')}</h3>
        <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate('logs/explorer?runtime=scheduler')}>
          <FileText size={13} /> {t('sch.logs.runtime')}
        </button>
      </header>
      <p className="pf-chart-note">{t('sch.logs.note')}</p>
      {runs.length === 0 ? (
        <p className="ov-empty-line">{t('sch.logs.empty')}</p>
      ) : (
        <div className="scp-table-wrap">
          <table className="scp-table">
            <thead>
              <tr>
                <th>{t('sch.exec.col.time')}</th>
                <th>{t('sch.exec.col.result')}</th>
                <th>{t('sch.exec.correlation')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.startedAt ? `${new Date(r.startedAt).toLocaleDateString()} ${formatTime(Date.parse(r.startedAt), true)}` : NO_VALUE}</td>
                  <td>
                    <button type="button" className="ov-link" onClick={() => openExecution(r)}>
                      <ExecutionStatusChip exec={r} />
                    </button>
                  </td>
                  <td>
                    <code>{r.correlationId}</code>
                  </td>
                  <td>
                    <button type="button" className="ov-link" onClick={() => logsOf(r.correlationId!)}>
                      <FileText size={12} /> {t('sch.exec.openLogs')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

const TaskConfigPanel: React.FC<{ data: TaskDetail }> = ({ data }) => {
  const { t } = useLocale();
  const x = data.task;
  const rows: [string, React.ReactNode][] = [
    ['taskId', <code key="taskId">{x.id}</code>],
    ['type', t(`sch.type.${x.type}`)],
    ['schedule', x.schedule.expression ? <code key="schedule">{x.schedule.expression}</code> : x.schedule.intervalMs ? formatInterval(x.schedule.intervalMs) : NO_VALUE],
    ['timezone', `${x.schedule.timezone} (${x.schedule.utcOffset})`],
    ['downstreamQueue', x.downstreamQueue ? <code key="downstreamQueue">{x.downstreamQueue}</code> : NO_VALUE],
  ];
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('sch.config.taskTitle')}</h3>
      </header>
      <div className="scp-table-wrap">
        <table className="scp-table tr-kv-table">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <th>{t(`sch.config.key.${k}`)}</th>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pf-chart-note">{t('sch.config.editNote')}</p>
    </section>
  );
};

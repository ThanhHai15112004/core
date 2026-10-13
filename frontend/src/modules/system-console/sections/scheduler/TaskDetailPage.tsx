import { useMemo } from 'react';
import { ArrowLeft, ArrowRight, Layers, Play, Power, PowerOff } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { useTicker } from '@core/hooks/useTicker';
import { NO_VALUE } from '@core/lib/format';
import { Badge, Button } from '@core/ui/primitives';
import {
  AlertList,
  KeyValueGrid,
  PageTabs,
  Panel,
  PanelGrid,
  PanelState,
  QueryView,
  StatGrid,
  StatTile,
  StatusBanner,
  type PageTab,
} from '@core/ui/blocks';
import { TimeSeriesChart } from '@core/ui/charts';
import { formatInterval } from '@core/lib/format';
import type { TaskDetail } from '../../types/scheduler.types';
import { schedulerApi } from '../../services/scheduler.api';
import { COUNTDOWN_TICK_MS, EXECUTION_TONE, LIST_MAX_HEIGHT_PX, SEVERITY_TONE, SUCCESS_RATE_WARN_PERCENT, TASK_DETAIL_TABS, type TaskPageTab } from '../../constants/scheduler';
import { formatDateTime, formatIn, secondsUntil } from '../../utils/scheduler-format';
import { ExecutionTable } from '../../components/scheduler/ExecutionTable';
import { SchedulerActivityChart } from '../../components/scheduler/SchedulerActivityChart';
import { DownstreamGrid } from '../../components/scheduler/DownstreamGrid';
import { ScheduleText, TaskHealthLabel, TaskStatusBadge } from '../../components/scheduler/SchedulerBadges';
import { ExecutionHistory } from './SchedulerHistoryTab';
import { schedulerKeys } from './scheduler-keys';
import type { SchedulerPage } from './useSchedulerPage';
import type { TaskActions } from './useTaskActions';

/**
 * Trang một task: trạng thái vận hành + sức khoẻ, lịch cho người đọc, Run Now / Bật / Tắt; tab Tổng quan · Lịch sử.
 * Lịch khai báo trong code — Console không sửa lịch.
 */
export function TaskDetailPage({ page, taskId, actions }: { page: SchedulerPage; taskId: string; actions: TaskActions }) {
  const { t } = useLocale();
  const query = useLiveQuery(schedulerKeys.task(taskId, page.range), () => schedulerApi.task(taskId, page.range), { keepPrevious: false });
  const tabs: PageTab<TaskPageTab>[] = TASK_DETAIL_TABS.map((id) => ({ id, label: t(`sch.detail.tab.${id}`) }));

  return (
    <>
      <Button variant="ghost" size="sm" className="-ml-2 mb-3" onClick={() => page.go('tasks')}>
        <ArrowLeft />
        {t('sch.detail.back')}
      </Button>
      <QueryView query={query}>
        {(d) => {
          const task = d.task;
          return (
            <>
              <Panel
                className="mb-4"
                title={
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{task.name}</span>
                    <span className="truncate font-mono text-xs font-normal text-faint">{task.id}</span>
                  </span>
                }
                actions={
                  <>
                    {d.settings.run && (
                      <Button size="sm" variant="primary" onClick={() => actions.request('run', task)}>
                        <Play />
                        {t('sch.action.run')}
                      </Button>
                    )}
                    {d.settings.toggle && (
                      <Button size="sm" onClick={() => actions.request(task.enabled ? 'disable' : 'enable', task)}>
                        {task.enabled ? <PowerOff /> : <Power />}
                        {t(`sch.action.${task.enabled ? 'disable' : 'enable'}`)}
                      </Button>
                    )}
                  </>
                }
              >
                <div className="flex flex-wrap items-center gap-2">
                  <TaskStatusBadge task={task} />
                  {task.status !== 'enabled' && task.status !== 'disabled' && (
                    <Badge tone={task.enabled ? 'ok' : 'unknown'}>{t(task.enabled ? 'sch.task.status.enabled' : 'sch.task.status.disabled')}</Badge>
                  )}
                  <TaskHealthLabel health={task.health} />
                </div>
                <div className="mt-2 text-sm">
                  <ScheduleText schedule={task.schedule} showTz />
                </div>
                {task.description && <p className="mt-1.5 text-sm text-muted">{task.description}</p>}
              </Panel>

              <PageTabs tabs={tabs} value={page.sub} onChange={(sub) => page.openTask(taskId, sub)} />
              {page.sub === 'history' ? <ExecutionHistory page={page} taskId={taskId} /> : <TaskOverview d={d} page={page} />}
            </>
          );
        }}
      </QueryView>
    </>
  );
}

function TaskOverview({ d, page }: { d: TaskDetail; page: SchedulerPage }) {
  const { t, locale, formatRelative } = useLocale();
  const f = useFormat();
  const now = useTicker(COUNTDOWN_TICK_MS);
  const { task, kpis } = d;
  const last = task.lastStatus;

  const durationSeries = useMemo(
    () => [{ id: 'duration', label: t('sch.detail.duration'), color: 'series-1' as const, points: d.durations.map((x) => ({ t: x.t, v: x.durationMs })) }],
    [d.durations, t],
  );
  const failureMarkers = useMemo(
    () => d.durations.filter((x) => x.status === 'failed').map((x) => ({ t: x.t, label: t('sch.exec.status.failed'), tone: EXECUTION_TONE.failed })),
    [d.durations, t],
  );

  const config = [
    { label: t('sch.config.key.taskId'), value: task.id, mono: true },
    { label: t('sch.config.key.type'), value: t(`sch.type.${task.type}`) },
    { label: t('sch.config.key.schedule'), value: task.schedule.expression ?? (task.schedule.intervalMs ? formatInterval(task.schedule.intervalMs) : null), mono: true },
    { label: t('sch.config.key.timezone'), value: `${task.schedule.timezone} (${task.schedule.utcOffset})`, mono: true },
    { label: t('sch.config.key.downstreamQueue'), value: task.downstreamQueue, mono: true },
    { label: t('sch.config.key.iterations'), value: task.iterations === null ? null : f.compact(task.iterations), mono: true },
  ];

  return (
    <>
      {d.consecutive && (
        <StatusBanner
          tone={d.consecutive.count >= 2 ? 'warn' : 'info'}
          title={t('sch.detail.consecutive.title', { count: d.consecutive.count })}
          description={
            <>
              {t('sch.detail.consecutive.lastSuccess', { time: d.consecutive.lastSuccessAt ? formatDateTime(d.consecutive.lastSuccessAt, locale, false) : t('sch.task.never') })}
              {d.consecutive.firstFailedAt && ` · ${t('sch.detail.consecutive.since', { time: formatDateTime(d.consecutive.firstFailedAt, locale, false) })}`}
              {task.lastError && (
                <span className="mt-1 block font-mono text-xs text-crit-fg">
                  {task.lastError.type}: {task.lastError.message}
                </span>
              )}
            </>
          }
          actions={
            task.lastExecutionId ? (
              <Button size="xs" variant="secondary" onClick={() => page.openExec(task.lastExecutionId)}>
                {t('sch.detail.consecutive.inspect')}
                <ArrowRight />
              </Button>
            ) : undefined
          }
        />
      )}

      <StatGrid columns={6}>
        <StatTile
          label={t('sch.detail.kpi.successRate')}
          value={f.percent(kpis.successRatePercent)}
          sub={t('sch.detail.kpi.successSub', { ok: f.compact(kpis.successful), total: f.compact(kpis.executions) })}
          tone={kpis.successRatePercent === null ? undefined : kpis.successRatePercent < SUCCESS_RATE_WARN_PERCENT ? 'warn' : 'ok'}
        />
        <StatTile
          label={t('sch.detail.kpi.lastRun')}
          value={last ? t(`sch.exec.status.${last}`) : NO_VALUE}
          sub={task.lastRunAt ? formatRelative(task.lastRunAt, now) : t('sch.task.never')}
          tone={last ? EXECUTION_TONE[last] : undefined}
          onClick={task.lastExecutionId ? () => page.openExec(task.lastExecutionId) : undefined}
        />
        <StatTile label={t('sch.detail.kpi.avgDuration')} value={f.duration(kpis.avgDurationMs)} sub={t('sch.detail.kpi.sampled', { count: kpis.sampled })} />
        <StatTile label={t('sch.detail.kpi.p95Duration')} value={f.duration(kpis.p95DurationMs)} />
        <StatTile
          label={t('sch.detail.kpi.nextRun')}
          value={task.nextRunAt ? formatIn(secondsUntil(task.nextRunAt, now)) : NO_VALUE}
          sub={task.nextRunAt ? formatDateTime(task.nextRunAt, locale, false) : t(`sch.task.status.${task.status}`)}
        />
        <StatTile
          label={t('sch.detail.kpi.failuresToday')}
          value={f.compact(kpis.failuresToday)}
          sub={t('sch.detail.kpi.failedSub', { count: f.compact(kpis.failed) })}
          tone={kpis.failuresToday > 0 ? 'warn' : 'ok'}
          onClick={() => page.openTask(task.id, 'history')}
        />
      </StatGrid>

      {d.running.length > 0 && (
        <Panel title={t('sch.running.title')} hint={t('sch.running.note')} flush className="mb-4">
          <ExecutionTable rows={d.running} columns={['time', 'result', 'duration', 'trigger']} onOpen={page.openExec} activeId={page.execId} />
        </Panel>
      )}

      <PanelGrid>
        <Panel title={t('sch.detail.performance')} hint={t('sch.detail.performanceHint', { count: d.durations.length })} expandable>
          <TimeSeriesChart
            series={durationSeries}
            markers={failureMarkers}
            format={(v) => f.duration(v)}
            emptyMessage={t('sch.detail.noDurations')}
            ariaLabel={t('sch.detail.performance')}
          />
        </Panel>
        <SchedulerActivityChart range={page.range} task={task.id} />
      </PanelGrid>

      {d.alerts.length > 0 && (
        <Panel title={t('sch.problems.title')} className="mb-4">
          <AlertList
            items={d.alerts.map((a) => ({
              id: a.id,
              tone: SEVERITY_TONE[a.severity],
              title: a.title,
              detail: a.message,
              since: a.since,
              onInspect: a.executionId ? () => page.openExec(a.executionId) : undefined,
            }))}
          />
        </Panel>
      )}

      <PanelGrid>
        <Panel title={t('sch.detail.next')} hint={task.schedule.timezone}>
          {d.next.length === 0 ? (
            <PanelState status="empty" compact message={t(`sch.detail.noNext.${task.enabled ? 'enabled' : 'disabled'}`)} />
          ) : (
            <ol className="flex flex-col divide-y divide-border">
              {d.next.map((at) => (
                <li key={at} className="flex items-center justify-between py-1.5 font-mono text-xs tabular-nums">
                  <span className="text-fg-2">{formatDateTime(at, locale, false)}</span>
                  <span className="text-faint">{formatIn(secondsUntil(at, now))}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel
          title={t('sch.downstream.title')}
          hint={t('sch.downstream.note')}
          actions={
            d.downstream ? (
              <Button size="xs" variant="ghost" onClick={() => page.navigate(`worker/queues/${encodeURIComponent(d.downstream!.queue)}`)}>
                <Layers />
                {t('sch.downstream.open')}
              </Button>
            ) : undefined
          }
        >
          {d.downstream ? <DownstreamGrid downstream={d.downstream} /> : <PanelState status="empty" compact message={t('sch.downstream.none')} />}
        </Panel>
      </PanelGrid>

      <PanelGrid>
        <Panel
          title={t('sch.recent.title')}
          flush
          actions={
            <Button size="xs" variant="ghost" onClick={() => page.openTask(task.id, 'history')}>
              {t('sch.recent.viewAll')}
              <ArrowRight />
            </Button>
          }
        >
          <ExecutionTable
            rows={d.recent}
            columns={['time', 'result', 'duration', 'trigger', 'logs']}
            onOpen={page.openExec}
            activeId={page.execId}
            navigate={page.navigate}
            emptyMessage={t('sch.recent.empty')}
            maxHeight={LIST_MAX_HEIGHT_PX}
          />
        </Panel>
        <Panel title={t('sch.config.taskTitle')} hint={t('sch.config.editNote')}>
          <KeyValueGrid items={config} />
        </Panel>
      </PanelGrid>
    </>
  );
}

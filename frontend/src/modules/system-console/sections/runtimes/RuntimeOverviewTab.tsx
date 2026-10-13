import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { ArrowRight } from 'lucide-react';
import { cn } from '@core/lib/cn';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { TONE_CLASS } from '@core/theme';
import { Badge, Button, Hint } from '@core/ui/primitives';
import { ActivityFeed, DataTable, KeyValueGrid, Panel, PanelGrid, PanelState, RelativeTime, StatGrid, StatTile } from '@core/ui/blocks';
import type { RuntimeDetail } from '../../types/runtime.types';
import { runtimesApi } from '../../services/runtimes.api';
import { DETAIL_EVENTS_LIMIT, DETAIL_EVENTS_PREVIEW, DETAIL_EXTRA_STATS, QUEUE_COUNT_KEYS, RUNTIME_METRICS } from '../../constants/runtime-metrics';
import { eventToActivity, metricTone, useDateTime, useMetricFormat } from '../../components/runtimes/runtime-view';
import { runtimesKeys } from './runtimes-keys';
import type { RuntimesPage } from './useRuntimesPage';

interface SchedulerTask {
  name: string;
  cron: string;
  running: boolean;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  failuresToday: number;
  runsToday: number;
  nextRunAt: string | null;
}

interface WorkerQueue {
  name: string;
  counts: Record<string, number> | null;
  consumed: boolean;
}

const taskCol = createColumnHelper<SchedulerTask>();
const queueCol = createColumnHelper<WorkerQueue>();

/** Tổng quan runtime: số chính → cảnh báo ngưỡng → metric riêng + process → task / queue → sự kiện gần đây. */
export function RuntimeOverviewTab({ d, page }: { d: RuntimeDetail; page: RuntimesPage }) {
  const { t } = useLocale();
  const f = useFormat();
  const metric = useMetricFormat();
  const dateTime = useDateTime();
  // Cùng key với tab Logs & Sự kiện → dùng chung cache.
  const events = useLiveQuery(runtimesKeys.events(DETAIL_EVENTS_LIMIT, d.id), () => runtimesApi.events(DETAIL_EVENTS_LIMIT, d.id));
  const r = d.resources;
  const p = d.process;
  const extra = RUNTIME_METRICS[d.id].filter((m) => m.card && m.kind !== 'time').slice(0, DETAIL_EXTRA_STATS);
  const cpuHigh = r ? r.cpuPercent >= d.thresholds.cpuPercent : false;
  const memHigh = r?.memoryPercent !== null && r?.memoryPercent !== undefined && r.memoryPercent >= d.thresholds.memoryPercent;

  return (
    <>
      <StatGrid columns={6}>
        <StatTile label={t('rt.metric.cpu')} value={f.percent(r?.cpuPercent)} tone={r ? (cpuHigh ? 'warn' : 'ok') : undefined} hint={t('rt.detail.thresholdHint', { value: f.percent(d.thresholds.cpuPercent) })} />
        <StatTile
          label={t('rt.metric.memory')}
          value={f.mb(r?.rssMb)}
          sub={r?.memoryPercent !== null && r?.memoryPercent !== undefined ? t('rt.detail.ofLimit', { percent: f.percent(r.memoryPercent) }) : undefined}
          tone={r ? (memHigh ? 'warn' : 'ok') : undefined}
          hint={t('rt.detail.thresholdHint', { value: f.percent(d.thresholds.memoryPercent) })}
        />
        <StatTile label={t('rt.metric.uptime')} value={f.uptime(d.uptimeSec)} />
        <StatTile label={t('rt.metric.restartCount')} value={f.number(d.restartCount)} sub={d.lastRestartAt ? <RelativeTime value={d.lastRestartAt} /> : undefined} />
        {extra.map((m) => (
          <StatTile key={m.key} label={t(`rt.metric.${m.key}`)} value={metric(d, m.key, m)} tone={metricTone(m, d.metrics[m.key])} />
        ))}
      </StatGrid>

      <PanelGrid>
        <Panel title={t(`rt.detail.specific.${d.id}`)}>
          <KeyValueGrid
            items={RUNTIME_METRICS[d.id].map((m) => {
              const mt = metricTone(m, d.metrics[m.key]);
              return { key: m.key, label: t(`rt.metric.${m.key}`), value: <span className={cn('font-mono tabular-nums', mt && TONE_CLASS[mt].fg)}>{metric(d, m.key, m)}</span> };
            })}
          />
        </Panel>
        <Panel title={t('rt.detail.process')}>
          <KeyValueGrid
            items={[
              { label: t('rt.process.pid'), value: p?.pid ?? d.pid, mono: true },
              { label: t('rt.process.ppid'), value: p?.ppid, mono: true },
              { label: t('rt.process.user'), value: p?.user },
              { label: t('rt.process.hostname'), value: p?.hostname, mono: true },
              { label: t('rt.process.platform'), value: p ? `${p.platform} / ${p.arch}` : null },
              { label: t('rt.process.node'), value: p?.nodeVersion, mono: true },
              { label: t('rt.process.startedAt'), value: d.startedAt ? dateTime(d.startedAt) : null },
              { label: t('rt.process.lastExitCode'), value: d.lastExitCode, mono: true },
              { label: t('rt.process.supervisor'), value: d.supervisor },
              { label: t('rt.process.execArgv'), value: p?.execArgv.length ? p.execArgv.join(' ') : null, mono: true },
            ]}
          />
        </Panel>
      </PanelGrid>

      {d.id === 'scheduler' && <SchedulerTasks tasks={(d.details['tasks'] as SchedulerTask[] | undefined) ?? []} navigate={page.navigate} />}
      {d.id === 'worker' && <WorkerQueues queues={(d.details['queues'] as WorkerQueue[] | undefined) ?? []} />}

      <Panel
        title={t('rt.events.recent')}
        actions={
          <Button size="xs" variant="ghost" onClick={() => page.go('logs')}>
            {t('rt.events.viewAll')}
            <ArrowRight />
          </Button>
        }
      >
        {events.data ? (
          <ActivityFeed items={events.data.slice(0, DETAIL_EVENTS_PREVIEW).map((e) => eventToActivity(e, false))} emptyMessage={t('rt.events.empty')} />
        ) : (
          <PanelState status={events.isError ? 'error' : 'loading'} error={events.error} onRetry={() => void events.refetch()} compact />
        )}
      </Panel>
    </>
  );
}

function SchedulerTasks({ tasks, navigate }: { tasks: SchedulerTask[]; navigate: (path: string) => void }) {
  const { t } = useLocale();
  const f = useFormat();
  const columns = useMemo(
    () => [
      taskCol.accessor('name', { header: t('rt.tasks.name'), cell: (c) => <span className="whitespace-nowrap font-medium text-fg">{c.getValue()}</span> }),
      taskCol.accessor('cron', { header: t('rt.tasks.cron'), meta: { mono: true } }),
      taskCol.accessor('running', {
        header: t('rt.tasks.state'),
        cell: (c) => (c.getValue() ? <Badge tone="info">{t('rt.tasks.running')}</Badge> : <span className="text-muted">{t('rt.tasks.idle')}</span>),
      }),
      taskCol.accessor('lastRunAt', { header: t('rt.tasks.lastRun'), cell: (c) => (c.getValue() ? <RelativeTime value={c.getValue()} /> : <span className="text-faint">{t('rt.never')}</span>) }),
      taskCol.accessor('lastDurationMs', { header: t('rt.tasks.duration'), cell: (c) => f.duration(c.getValue()), meta: { mono: true, align: 'right' } }),
      taskCol.accessor('nextRunAt', { header: t('rt.tasks.nextRun'), cell: (c) => <RelativeTime value={c.getValue()} /> }),
      taskCol.accessor('failuresToday', {
        header: t('rt.tasks.failures'),
        cell: (c) => (
          <Hint content={c.row.original.lastError}>
            <span className={c.getValue() > 0 ? 'text-crit-fg' : undefined}>
              {c.getValue()} / {c.row.original.runsToday}
            </span>
          </Hint>
        ),
        meta: { mono: true, align: 'right' },
      }),
    ],
    [t, f],
  );
  return (
    <Panel
      title={t('rt.tasks.title')}
      flush
      className="mb-4"
      actions={
        <Button size="xs" variant="ghost" onClick={() => navigate('scheduler')}>
          {t('rt.tasks.openScheduler')}
          <ArrowRight />
        </Button>
      }
    >
      <DataTable data={tasks} columns={columns} getRowId={(x) => x.name} emptyMessage={t('rt.tasks.empty')} rowTone={(x) => (x.failuresToday > 0 ? 'crit' : undefined)} />
    </Panel>
  );
}

function WorkerQueues({ queues }: { queues: WorkerQueue[] }) {
  const { t } = useLocale();
  const f = useFormat();
  const columns = useMemo(
    () => [
      queueCol.accessor('name', { header: t('rt.queues.name'), meta: { mono: true, truncate: true } }),
      ...QUEUE_COUNT_KEYS.map((k) =>
        queueCol.accessor((q) => q.counts?.[k] ?? null, {
          id: k,
          header: t(`rt.queues.${k}`),
          cell: (c) => {
            const v = c.getValue();
            return <span className={k === 'failed' && (v ?? 0) > 0 ? 'text-crit-fg' : undefined}>{c.row.original.counts ? f.number(v ?? 0) : NO_VALUE}</span>;
          },
          meta: { mono: true, align: 'right' as const },
        }),
      ),
      queueCol.accessor('consumed', { header: t('rt.queues.consumed'), cell: (c) => (c.getValue() ? t('rt.queues.yes') : <span className="text-faint">{t('rt.queues.no')}</span>) }),
    ],
    [t, f],
  );
  return (
    <Panel title={t('rt.queues.title')} flush className="mb-4">
      <DataTable data={queues} columns={columns} getRowId={(q) => q.name} emptyMessage={t('rt.queues.empty')} />
    </Panel>
  );
}

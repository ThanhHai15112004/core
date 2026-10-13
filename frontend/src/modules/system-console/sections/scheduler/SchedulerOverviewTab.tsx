import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowRight, Cpu } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { useTicker } from '@core/hooks/useTicker';
import { NO_VALUE } from '@core/lib/format';
import { Badge, Button } from '@core/ui/primitives';
import {
  ActivityFeed,
  AlertList,
  ComparisonTable,
  KeyValueGrid,
  Panel,
  PanelGrid,
  PanelState,
  QueryView,
  RelativeTime,
  StatGrid,
  StatTile,
  StatusDot,
  type ActivityItem,
  type AlertItem,
  type ComparisonRow,
} from '@core/ui/blocks';
import type { SchedulerAlert, SchedulerOverview, SchedulerReport } from '../../types/scheduler.types';
import { schedulerApi } from '../../services/scheduler.api';
import { ACTIVITY_MAX_HEIGHT_PX, COUNTDOWN_TICK_MS, LIST_MAX_HEIGHT_PX, SEVERITY_TONE, SUCCESS_RATE_WARN_PERCENT } from '../../constants/scheduler';
import { formatIn, secondsUntil } from '../../utils/scheduler-format';
import { SchedulerActivityChart } from '../../components/scheduler/SchedulerActivityChart';
import { ExecutionTable } from '../../components/scheduler/ExecutionTable';
import { ConcentrationList, UpcomingTable } from '../../components/scheduler/UpcomingTable';
import { schedulerKeys } from './scheduler-keys';
import type { SchedulerPage } from './useSchedulerPage';

const REPORT_ROWS: { key: keyof SchedulerReport; kind: 'count' | 'percent' | 'ms'; higherIsWorse: boolean | null }[] = [
  { key: 'executions', kind: 'count', higherIsWorse: null },
  { key: 'successful', kind: 'count', higherIsWorse: null },
  { key: 'failed', kind: 'count', higherIsWorse: true },
  { key: 'successRatePercent', kind: 'percent', higherIsWorse: false },
  { key: 'avgDurationMs', kind: 'ms', higherIsWorse: true },
  { key: 'p95DurationMs', kind: 'ms', higherIsWorse: true },
  { key: 'manualRuns', kind: 'count', higherIsWorse: null },
];

/**
 * Tổng quan: 6 chỉ số → hoạt động + vấn đề hiện tại → đang chạy → sắp chạy + lần chạy gần đây → runtime + báo cáo
 * hôm nay / hôm qua → thao tác gần đây. Luồng: phát hiện vấn đề → task → lịch sử → lần chạy → Run Now / Tắt.
 */
export function SchedulerOverviewTab({ page, query }: { page: SchedulerPage; query: UseQueryResult<SchedulerOverview> }) {
  const { t } = useLocale();
  const f = useFormat();
  const now = useTicker(COUNTDOWN_TICK_MS);
  const { range, go, openTask, openExec, navigate } = page;
  const ops = useLiveQuery(schedulerKeys.operations(), () => schedulerApi.operations(), { tier: 'slow' });
  const data = query.data;
  const k = data?.kpis;
  /** Chưa có dữ liệu: đang tải hoặc lỗi (thử lại) — không kẹt ở khung chờ khi API lỗi. */
  const loading = !data && !query.isError;
  const waiting = (className?: string) => <PanelState status={query.isError ? 'error' : 'loading'} error={query.error} onRetry={() => void query.refetch()} compact className={className} />;

  const ruleTone = (rule: string) => {
    const hits = data?.alerts.filter((a) => a.rule === rule) ?? [];
    return hits.some((a) => a.severity === 'critical') ? 'crit' : hits.length ? 'warn' : null;
  };
  const openAlert = (a: SchedulerAlert) => {
    if (a.taskId) openTask(a.taskId);
    else if (a.executionId) openExec(a.executionId);
    else if (a.tab === 'tasks' || a.tab === 'history' || a.tab === 'timeline') go(a.tab);
    else navigate('runtimes/scheduler');
  };
  const alerts: AlertItem[] = (data?.alerts ?? []).map((a) => ({ id: a.id, tone: SEVERITY_TONE[a.severity], title: a.title, detail: a.message, since: a.since, onInspect: () => openAlert(a) }));
  const okChecks = data?.instance && !data.alerts.some((a) => a.rule === 'CONSECUTIVE_FAILURES') ? [t('sch.problems.noFailures')] : [];
  const nextTask = data?.tasks.find((x) => x.id === k?.nextExecutionTask);

  const fmt = (kind: 'count' | 'percent' | 'ms') => (v: number | null) => (kind === 'ms' ? f.duration(v) : kind === 'percent' ? f.percent(v) : f.compact(v));
  const reportRows: ComparisonRow[] = data
    ? REPORT_ROWS.map((r) => ({
        id: r.key,
        label: t(`sch.report.${r.key}`),
        current: data.report.today[r.key],
        previous: data.report.yesterday[r.key],
        format: fmt(r.kind),
        higherIsWorse: r.higherIsWorse,
      }))
    : [];

  const activity: ActivityItem[] = (ops.data ?? []).map((o) => ({
    id: o.id,
    at: o.at,
    tone: o.result === 'success' ? 'ok' : 'crit',
    title: `${t(`sch.audit.kind.${o.action}`)} · ${o.target}`,
    source: [o.actor ?? t('sch.audit.anonymous'), o.ip].filter(Boolean).join(' · '),
    detail: [o.detail, o.error, f.duration(o.durationMs)].filter(Boolean).join(' · '),
    onClick: o.executionId ? () => openExec(o.executionId!) : undefined,
  }));

  const inst = data?.instance ?? null;
  const alive = inst !== null && data?.health.status !== 'down';

  return (
    <>
      <StatGrid columns={6}>
        <StatTile
          label={t('sch.kpi.enabled')}
          value={k ? `${f.compact(k.enabled)} / ${f.compact(k.registered)}` : NO_VALUE}
          sub={k && k.disabled > 0 ? t('sch.kpi.disabledSub', { count: k.disabled }) : undefined}
          tone={k ? (k.registered === 0 ? 'unknown' : 'ok') : undefined}
          loading={loading}
          onClick={() => go('tasks')}
        />
        <StatTile label={t('sch.kpi.running')} value={f.compact(k?.running)} hint={t('sch.kpi.runningHint')} tone={k && k.running > 0 ? 'info' : undefined} loading={loading} />
        <StatTile
          label={t('sch.kpi.failedToday')}
          value={f.compact(k?.failedToday)}
          sub={k ? t('sch.kpi.failedSub', { count: f.compact(k.executionsToday) }) : undefined}
          tone={k ? (ruleTone('CONSECUTIVE_FAILURES') ?? (k.failedToday > 0 ? 'warn' : 'ok')) : undefined}
          loading={loading}
          onClick={() => go('history', { status: 'failed' })}
        />
        <StatTile
          label={t('sch.kpi.successRate')}
          value={f.percent(k?.successRatePercent)}
          hint={t('sch.kpi.successHint')}
          tone={k?.successRatePercent === null || k?.successRatePercent === undefined ? undefined : k.successRatePercent < SUCCESS_RATE_WARN_PERCENT ? 'warn' : 'ok'}
          loading={loading}
        />
        <StatTile
          label={t('sch.kpi.avgDuration')}
          value={f.duration(k?.avgDurationMs)}
          sub={k ? t('sch.kpi.p95Sub', { value: f.duration(k.p95DurationMs) }) : undefined}
          hint={t('sch.kpi.durationHint', { range: t(`ui.time.ranges.${range}`) })}
          loading={loading}
        />
        <StatTile
          label={t('sch.kpi.next')}
          value={k?.nextExecutionAt ? formatIn(secondsUntil(k.nextExecutionAt, now)) : NO_VALUE}
          sub={k ? (nextTask?.name ?? t('sch.kpi.nextNone')) : undefined}
          loading={loading}
          onClick={nextTask ? () => openTask(nextTask.id) : undefined}
        />
      </StatGrid>

      <PanelGrid layout="2-1">
        <SchedulerActivityChart range={range} />
        <Panel title={t('sch.problems.title')} actions={alerts.length > 0 ? <Badge tone={alerts.some((a) => a.tone === 'crit') ? 'crit' : 'warn'}>{alerts.length}</Badge> : undefined}>
          {data ? <AlertList items={alerts} okChecks={okChecks} emptyMessage={t('sch.problems.allGood')} /> : waiting()}
        </Panel>
      </PanelGrid>

      {data && data.running.length > 0 && (
        <Panel title={t('sch.running.title')} hint={t('sch.running.note')} flush className="mb-4" actions={<Badge tone="info">{data.running.length}</Badge>}>
          <ExecutionTable rows={data.running} columns={['time', 'task', 'result', 'duration', 'trigger']} onOpen={openExec} activeId={page.execId} />
        </Panel>
      )}

      <PanelGrid>
        <Panel
          title={t('sch.upcoming.title')}
          flush
          actions={
            <Button size="xs" variant="ghost" onClick={() => go('timeline')}>
              {t('sch.upcoming.timeline')}
              <ArrowRight />
            </Button>
          }
        >
          {data ? (
            <>
              <ConcentrationList items={data.concentration} className="border-b border-border px-3 py-1" />
              <UpcomingTable items={data.upcoming} onOpenTask={openTask} maxHeight={LIST_MAX_HEIGHT_PX} />
            </>
          ) : (
            waiting('p-3')
          )}
        </Panel>
        <Panel
          title={t('sch.recent.title')}
          flush
          actions={
            <Button size="xs" variant="ghost" onClick={() => go('history')}>
              {t('sch.recent.viewAll')}
              <ArrowRight />
            </Button>
          }
        >
          {data ? (
            <ExecutionTable rows={data.recent} columns={['time', 'task', 'result', 'duration']} onOpen={openExec} activeId={page.execId} emptyMessage={t('sch.recent.empty')} maxHeight={LIST_MAX_HEIGHT_PX} />
          ) : (
            waiting('p-3')
          )}
        </Panel>
      </PanelGrid>

      <PanelGrid>
        <Panel
          title={t('sch.runtime.title')}
          hint={t('sch.runtime.note')}
          actions={
            <Button size="xs" variant="ghost" onClick={() => navigate('runtimes/scheduler')}>
              <Cpu />
              {t('sch.health.inspectRuntime')}
            </Button>
          }
        >
          {!data ? (
            waiting()
          ) : !inst ? (
            <PanelState status="empty" compact message={t('sch.runtime.none')} />
          ) : (
            <KeyValueGrid
              items={[
                {
                  label: t('sch.runtime.instance'),
                  value: (
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                      <StatusDot tone={!alive ? 'crit' : inst.paused ? 'unknown' : 'ok'} size="xs" />
                      {inst.instance}
                      {inst.paused && <Badge tone="unknown">{t('sch.runtime.paused')}</Badge>}
                    </span>
                  ),
                },
                { label: t('sch.runtime.host'), value: `${inst.host} · ${t('sch.runtime.pid', { pid: inst.pid })}`, mono: true },
                { label: t('sch.runtime.uptime'), value: alive ? f.uptime(inst.uptimeSec) : null, mono: true },
                {
                  label: t('sch.runtime.heartbeat'),
                  value: (
                    <span className={alive ? undefined : 'text-crit-fg'}>
                      <RelativeTime value={inst.lastSeenAt} />
                      <span className="ml-1.5 font-mono text-xs text-faint">{t('sch.runtime.heartbeatAge', { age: f.uptime(inst.heartbeatAgeSec) })}</span>
                    </span>
                  ),
                },
                { label: t('sch.runtime.lock'), value: t('sch.runtime.lockValue') },
                { label: t('sch.kpi.running'), value: f.compact(data.kpis.running), mono: true },
              ]}
            />
          )}
        </Panel>
        <Panel title={t('sch.report.title')} hint={t('sch.report.hint')}>
          {data ? <ComparisonTable rows={reportRows} /> : waiting()}
        </Panel>
      </PanelGrid>

      <Panel title={t('sch.audit.title')} hint={t('sch.audit.note')}>
        <QueryView query={ops} compact>
          {() => <ActivityFeed items={activity} emptyMessage={t('sch.audit.empty')} maxHeight={ACTIVITY_MAX_HEIGHT_PX} />}
        </QueryView>
      </Panel>
    </>
  );
}

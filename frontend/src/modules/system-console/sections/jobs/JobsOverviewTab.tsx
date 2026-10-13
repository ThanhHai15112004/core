import { useMemo } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Button } from '@core/ui/primitives';
import { AlertList, ComparisonTable, DataTable, Panel, PanelGrid, PanelState, QueryView, StatGrid, StatTile, type AlertItem, type ComparisonRow } from '@core/ui/blocks';
import { BarList } from '@core/ui/charts';
import type { JobPriorityLevel, JobProblem, JobsOverview, JobsReport, JobTypeRow } from '../../types/jobs.types';
import { jobsApi } from '../../services/jobs.api';
import {
  FAILURE_RATE_WARN_PERCENT,
  KPI_FILTER,
  LONG_RUNNING_COLUMNS,
  OVERVIEW_GROUP_LIMIT,
  PRIORITY_WAIT_WARN_SEC,
  PROBLEM_JOB_CODES,
  PROBLEM_TONE,
  STALLED_COLUMNS,
  SUCCESS_RATE_WARN_PERCENT,
  TOP_TYPES_LIMIT,
  URGENT_PRIORITIES,
} from '../../constants/jobs';
import { JobTable } from '../../components/jobs/JobTable';
import { FailureGroups } from '../../components/jobs/FailureGroups';
import { ProviderSection } from '../../components/jobs/ProviderSection';
import { JobsActivityChart } from './JobsActivityChart';
import { jobsKeys } from './jobs-keys';
import type { JobsPage } from './useJobsPage';

type PriorityRow = { level: JobPriorityLevel; waiting: number; oldestSec: number | null };
const prioCol = createColumnHelper<PriorityRow>();
const typeCol = createColumnHelper<JobTypeRow>();
const REPORT_ROWS: { key: keyof JobsReport; kind: 'count' | 'percent' | 'ms'; higherIsWorse: boolean | null }[] = [
  { key: 'created', kind: 'count', higherIsWorse: null },
  { key: 'completed', kind: 'count', higherIsWorse: false },
  { key: 'failed', kind: 'count', higherIsWorse: true },
  { key: 'retried', kind: 'count', higherIsWorse: true },
  { key: 'successRatePercent', kind: 'percent', higherIsWorse: false },
  { key: 'avgWaitMs', kind: 'ms', higherIsWorse: true },
  { key: 'avgProcessingMs', kind: 'ms', higherIsWorse: true },
  { key: 'p95ProcessingMs', kind: 'ms', higherIsWorse: true },
];

/**
 * Tổng quan Jobs: 6 chỉ số (bấm → Explorer), hoạt động job + vấn đề hiện tại, nhóm lỗi, chờ theo độ ưu tiên, job chạy
 * lâu / treo, báo cáo hôm nay vs hôm qua, hiệu năng theo loại job.
 */
export function JobsOverviewTab({ page, overview }: { page: JobsPage; overview: UseQueryResult<JobsOverview> }) {
  return <QueryView query={overview}>{(data) => <OverviewBody page={page} data={data} />}</QueryView>;
}

function OverviewBody({ page, data }: { page: JobsPage; data: JobsOverview }) {
  const { t } = useLocale();
  const f = useFormat();
  const { range, explore, openJob, go } = page;
  const report = useLiveQuery(jobsKeys.report(range), () => jobsApi.report(range), { tier: 'slow' });
  const k = data.kpis;
  const has = (code: string) => data.problems.find((p) => p.code === code);
  const problemTone = (code: string) => {
    const p = has(code);
    return p ? PROBLEM_TONE[p.severity] : undefined;
  };

  const openProblem = (p: JobProblem) => {
    if (p.jobId && PROBLEM_JOB_CODES.has(p.code)) return openJob(p.jobId, p.queue);
    if (p.filter) return explore({ ...p.filter });
    go('explorer');
  };
  const problems: AlertItem[] = data.problems.map((p) => ({ id: p.id, tone: PROBLEM_TONE[p.severity], title: p.message, onInspect: () => openProblem(p) }));

  const prioCols = useMemo(
    () => [
      prioCol.accessor('level', { header: t('jobs.col.priority'), cell: (c) => t(`jobs.priority.${c.getValue()}`) }),
      prioCol.accessor('waiting', { header: t('jobs.priority.waiting'), cell: (c) => f.compact(c.getValue()), meta: { align: 'right', mono: true } }),
      prioCol.accessor('oldestSec', {
        header: t('jobs.priority.oldest'),
        cell: (c) => {
          const v = c.getValue();
          const warn = URGENT_PRIORITIES.includes(c.row.original.level) && (v ?? 0) >= PRIORITY_WAIT_WARN_SEC;
          return <span className={warn ? 'text-warn-fg' : undefined}>{v === null ? NO_VALUE : f.duration(v * 1000)}</span>;
        },
        meta: { align: 'right', mono: true },
      }),
    ],
    [t, f],
  );
  const typeCols = useMemo(
    () => [
      typeCol.accessor('type', { header: t('jobs.types.col.type'), cell: (c) => <span className="font-medium text-fg">{c.getValue()}</span>, meta: { truncate: true } }),
      typeCol.accessor('created', { header: t('jobs.types.col.created'), cell: (c) => f.compact(c.getValue()), meta: { align: 'right', mono: true } }),
      typeCol.accessor('runs', { header: t('jobs.types.col.runs'), cell: (c) => f.compact(c.getValue()), meta: { align: 'right', mono: true } }),
      typeCol.accessor('avgMs', { header: t('jobs.types.col.avg'), cell: (c) => f.duration(c.getValue()), meta: { align: 'right', mono: true } }),
      typeCol.accessor('p95Ms', { header: t('jobs.types.col.p95'), cell: (c) => f.duration(c.getValue()), meta: { align: 'right', mono: true } }),
      typeCol.accessor('failureRatePercent', {
        header: t('jobs.types.col.failure'),
        cell: (c) => <span className={(c.getValue() ?? 0) >= FAILURE_RATE_WARN_PERCENT ? 'text-warn-fg' : undefined}>{f.percent(c.getValue())}</span>,
        meta: { align: 'right', mono: true },
      }),
    ],
    [t, f],
  );

  const fmtReport = (kind: 'count' | 'percent' | 'ms') => (v: number | null) => (kind === 'percent' ? f.percent(v) : kind === 'ms' ? f.duration(v) : f.compact(v));
  const topTypes = report.data ? [...report.data.types].sort((a, b) => b.created - a.created).slice(0, TOP_TYPES_LIMIT) : [];
  const rangeLabel = t('ui.time.last', { range: t(`ui.time.ranges.${range}`) });

  return (
    <>
      <StatGrid columns={6}>
        <StatTile
          label={t('jobs.kpi.waiting')}
          value={f.compact(k.waiting)}
          sub={k.delayed !== null ? t('jobs.kpi.delayedCount', { count: f.compact(k.delayed) }) : undefined}
          hint={t('jobs.kpi.waitingHint')}
          tone={problemTone('OLDEST_WAITING') ?? (has('NO_WORKER') ? 'crit' : undefined)}
          onClick={() => explore(KPI_FILTER.waiting)}
        />
        <StatTile
          label={t('jobs.kpi.active')}
          value={f.compact(k.active)}
          sub={k.stalled !== null ? t('jobs.kpi.stalledCount', { count: f.compact(k.stalled) }) : undefined}
          hint={t('jobs.kpi.activeHint')}
          tone={(k.stalled ?? 0) > 0 ? 'crit' : problemTone('LONG_RUNNING')}
          onClick={() => explore((k.stalled ?? 0) > 0 ? { status: 'stalled' } : KPI_FILTER.active)}
        />
        <StatTile label={t('jobs.kpi.completedToday')} value={f.compact(k.completedToday)} hint={t('jobs.kpi.todayHint')} onClick={() => explore(KPI_FILTER.completedToday)} />
        <StatTile
          label={t('jobs.kpi.failedToday')}
          value={f.compact(k.failedToday)}
          sub={k.failedNow !== null ? t('jobs.kpi.failedNow', { count: f.compact(k.failedNow) }) : undefined}
          hint={t('jobs.kpi.todayHint')}
          tone={problemTone('FAILURES') ?? (k.failedToday > 0 ? 'warn' : 'ok')}
          onClick={() => explore(KPI_FILTER.failedToday)}
        />
        <StatTile
          label={t('jobs.kpi.retrying')}
          value={f.compact(k.retrying)}
          hint={t('jobs.kpi.retryingHint')}
          tone={problemTone('RETRY_STORM') ?? ((k.retrying ?? 0) > 0 ? 'warn' : undefined)}
          onClick={() => explore(KPI_FILTER.retrying)}
        />
        <StatTile
          label={t('jobs.kpi.successRate')}
          value={f.percent(k.successRatePercent)}
          hint={t('jobs.kpi.todayHint')}
          tone={k.successRatePercent === null ? undefined : k.successRatePercent < SUCCESS_RATE_WARN_PERCENT ? 'warn' : 'ok'}
          onClick={() => explore(KPI_FILTER.successRate)}
        />
      </StatGrid>

      <PanelGrid layout="2-1">
        <JobsActivityChart range={range} queues={data.queues} rate={data.rate} />
        <Panel title={t('jobs.problems.title')}>
          {data.status === 'unavailable' ? (
            <PanelState status="no-source" compact message={t('jobs.problems.unavailable', { state: data.provider.connection })} />
          ) : (
            <AlertList items={problems} emptyMessage={t('jobs.problems.allGood')} />
          )}
        </Panel>
      </PanelGrid>

      <PanelGrid>
        <Panel
          title={t('jobs.failures.groups')}
          flush
          actions={
            <Button size="xs" variant="ghost" onClick={() => go('failures')}>
              {t('jobs.failures.viewAll')}
            </Button>
          }
        >
          <ProviderSection section={data.failureGroups}>
            {(groups) => <FailureGroups groups={groups.slice(0, OVERVIEW_GROUP_LIMIT)} onOpen={(g) => explore({ status: 'failed', errorType: g.errorType })} />}
          </ProviderSection>
        </Panel>
        <Panel title={t('jobs.priority.title')} hint={t('jobs.priority.note')} flush>
          <ProviderSection section={data.priorities}>
            {(rows) => (
              <DataTable
                data={rows}
                columns={prioCols}
                getRowId={(r) => r.level}
                onRowClick={(r) => explore({ status: 'waiting', priority: r.level })}
                emptyMessage={t('jobs.priority.none')}
              />
            )}
          </ProviderSection>
        </Panel>
      </PanelGrid>

      <PanelGrid>
        <Panel title={t('jobs.longRunning.title')} flush>
          <ProviderSection section={data.longRunning}>
            {(rows) => <JobTable rows={rows} columns={LONG_RUNNING_COLUMNS} onOpen={(j) => openJob(j.id, j.queue)} emptyMessage={t('jobs.longRunning.none')} />}
          </ProviderSection>
        </Panel>
        <Panel title={t('jobs.stalled.title')} hint={t('jobs.stalled.hint')} flush>
          <ProviderSection section={data.stalled}>
            {(rows) => <JobTable rows={rows} columns={STALLED_COLUMNS} onOpen={(j) => openJob(j.id, j.queue)} emptyMessage={t('jobs.stalled.none')} />}
          </ProviderSection>
        </Panel>
      </PanelGrid>

      <PanelGrid>
        <Panel title={t('jobs.report.title')}>
          <QueryView query={report} compact>
            {(r) => (
              <ComparisonTable
                labels={{ current: t('jobs.report.today'), previous: t('jobs.report.yesterday') }}
                rows={REPORT_ROWS.map(
                  (row): ComparisonRow => ({
                    id: row.key,
                    label: t(`jobs.report.${row.key}`),
                    current: r.today[row.key],
                    previous: r.yesterday[row.key],
                    format: fmtReport(row.kind),
                    higherIsWorse: row.higherIsWorse,
                  }),
                )}
              />
            )}
          </QueryView>
        </Panel>
        <Panel title={t('jobs.report.topTypes')} hint={rangeLabel}>
          <QueryView query={report} compact isEmpty={(r) => r.types.length === 0} emptyMessage={t('jobs.report.noTypes')}>
            {() => (
              <BarList
                items={topTypes.map((x) => ({
                  id: x.type,
                  label: x.type,
                  value: x.created,
                  display: f.compact(x.created),
                  sub: x.failed > 0 ? <span className="text-crit-fg">{t('jobs.report.failedCount', { count: f.compact(x.failed) })}</span> : undefined,
                  onClick: () => explore({ type: x.type }),
                }))}
              />
            )}
          </QueryView>
        </Panel>
      </PanelGrid>

      <Panel title={t('jobs.types.title')} hint={rangeLabel} flush className="mb-4">
        <QueryView query={report} compact>
          {(r) => (
            <DataTable
              data={r.types}
              columns={typeCols}
              getRowId={(x) => x.type}
              onRowClick={(x) => explore({ type: x.type })}
              initialSorting={[{ id: 'created', desc: true }]}
              emptyMessage={t('jobs.report.noTypes')}
            />
          )}
        </QueryView>
      </Panel>
    </>
  );
}

import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import type { Tone } from '@core/theme';
import { Button } from '@core/ui/primitives';
import { AlertList, ComparisonTable, Panel, PanelGrid, PanelState, StatGrid, StatTile, type ComparisonRow, AvailableView } from '@core/ui/blocks';
import { BarList } from '@core/ui/charts';
import type { WorkerAlert, WorkerOverview, WorkerReport } from '../../types/worker.types';
import { DISTRIBUTION_WARN_PERCENT, OVERVIEW_QUEUE_LIMIT, QUEUE_STATUS_RANK } from '../../constants/worker';
import { QueueMetricChart } from '../../components/worker/QueueMetricChart';
import { QueueTable } from '../../components/worker/QueueTable';
import { RateBalance } from '../../components/worker/RateBalance';
import { toAlertItems } from '../../components/worker/worker-ui';
import type { WorkerPage } from './useWorkerPage';

interface Props {
  page: WorkerPage;
  overview: UseQueryResult<WorkerOverview>;
  openAlert: (a: WorkerAlert) => void;
}

/** Cảnh báo → tông theo mức nặng nhất của các rule liên quan (null = không có cảnh báo). */
function alertTone(alerts: WorkerAlert[], rules: string[]): Tone | null {
  const hits = alerts.filter((a) => rules.includes(a.rule));
  return hits.some((a) => a.severity === 'critical') ? 'crit' : hits.some((a) => a.severity === 'warning') ? 'warn' : null;
}

/**
 * Tổng quan: 6 chỉ số → hiệu năng queue + vấn đề hiện tại → nhận vào vs xử lý, phân bổ, báo cáo → queue cần chú ý.
 * Không có số liệu thì hiện `—`, không tự điền 0.
 */
export function WorkerOverviewTab({ page, overview, openAlert }: Props) {
  const { t } = useLocale();
  const f = useFormat();
  const data = overview.data;
  const loading = !data && !overview.isError;
  const k = data?.kpis;
  const alerts = data?.alerts ?? [];
  const queueRows = data?.queues.available ? data.queues.data : [];
  const fallback = <PanelState status={overview.isError ? 'error' : 'loading'} error={overview.error} onRetry={() => void overview.refetch()} />;

  const okChecks: string[] = [];
  if (data) {
    const rules = new Set(alerts.map((a) => a.rule));
    if (data.health.state === 'connected') okChecks.push(t('wq.alerts.connected'));
    if (data.kpis.workers > 0 && !rules.has('NO_WORKER')) okChecks.push(t('wq.alerts.workersOk', { count: data.kpis.workers }));
    if (data.queues.available && !rules.has('BACKLOG') && !rules.has('OLDEST_WAITING')) okChecks.push(t('wq.alerts.backlogOk'));
    if (data.failures.stalled === 0) okChecks.push(t('wq.alerts.noStalled'));
  }

  const oldestQueue = data?.wait.oldestJobId ? queueRows.find((q) => q.oldestWaitingId === data.wait.oldestJobId) : undefined;
  const reportRow = (key: keyof WorkerReport, format: (v: number | null) => string, higherIsWorse: boolean | null): ComparisonRow => ({
    id: key,
    label: t(`wq.report.${key}`),
    current: data?.report.today[key] ?? null,
    previous: data?.report.yesterday[key] ?? null,
    format,
    higherIsWorse,
  });
  const n = (v: number | null) => f.compact(v);

  // Tổng quan không tải được: banner lỗi (kèm thử lại) ở đầu trang đã đủ — không lặp lại lỗi ở từng panel.
  if (!data && overview.isError) return <QueueMetricChart range={page.range} title={t('wq.chart.title')} />;

  return (
    <>
      <StatGrid columns={6}>
        <StatTile
          label={t('wq.kpi.workers')}
          value={k ? (k.brokerWorkers === null ? f.number(k.workers) : `${f.number(k.workers)} / ${f.number(k.brokerWorkers)}`) : NO_VALUE}
          hint={t('wq.kpi.workersHint')}
          tone={k ? (alertTone(alerts, ['NO_WORKER', 'WORKER_PRESSURE']) ?? (k.workers === 0 && (k.waiting ?? 0) > 0 ? 'crit' : k.workers > 0 ? 'ok' : undefined)) : undefined}
          loading={loading}
          onClick={() => page.go('workers')}
        />
        <StatTile
          label={t('wq.kpi.waiting')}
          value={n(k?.waiting ?? null)}
          sub={k ? t('wq.kpi.delayed', { count: n(k.delayed) }) : undefined}
          tone={k ? (alertTone(alerts, ['BACKLOG', 'OLDEST_WAITING', 'NO_WORKER', 'QUEUE_PAUSED']) ?? undefined) : undefined}
          loading={loading}
          onClick={() => page.go('queues')}
        />
        <StatTile
          label={t('wq.kpi.active')}
          value={n(k?.active ?? null)}
          sub={data?.concurrency ? t('wq.kpi.slots', { active: data.concurrency.active, configured: data.concurrency.configured }) : undefined}
          tone={k ? (alertTone(alerts, ['CAPACITY', 'STALLED_JOBS']) ?? undefined) : undefined}
          loading={loading}
        />
        <StatTile
          label={t('wq.kpi.failed')}
          value={n(k?.failed ?? null)}
          sub={k ? t('wq.kpi.retrying', { count: n(k.retrying) }) : undefined}
          hint={data ? t('wq.kpi.failedHint', { count: n(k?.failedInRange ?? null), range: t(`ui.time.ranges.${data.range}`) }) : undefined}
          tone={k ? (alertTone(alerts, ['FAILURE_RATE', 'RETRY_STORM']) ?? ((k.failed ?? 0) > 0 ? 'warn' : k.failed === null ? undefined : 'ok')) : undefined}
          loading={loading}
          onClick={() => page.go('activity')}
        />
        <StatTile
          label={t('wq.kpi.throughput')}
          value={f.rate(k?.throughputPerMin, 'min')}
          hint={t('wq.kpi.throughputHint')}
          loading={loading}
        />
        <StatTile
          label={t('wq.kpi.duration')}
          value={f.duration(k?.avgDurationMs)}
          sub={data ? t('wq.kpi.p95', { value: f.duration(data.processing.p95Ms) }) : undefined}
          tone={k ? (alertTone(alerts, ['SLOW_PROCESSING']) ?? undefined) : undefined}
          loading={loading}
        />
      </StatGrid>

      <PanelGrid layout="2-1">
        <QueueMetricChart range={page.range} title={t('wq.chart.title')} queues={queueRows.map((q) => q.name)} />
        <Panel title={t('wq.alerts.current')}>{data ? <AlertList items={toAlertItems(alerts, openAlert)} okChecks={okChecks} /> : fallback}</Panel>
      </PanelGrid>

      <PanelGrid layout={3}>
        <Panel title={t('wq.rates.title')}>
          {data ? (
            <RateBalance
              rates={data.rates}
              wait={data.wait}
              processing={data.processing}
              onOpenOldest={oldestQueue && data.wait.oldestJobId ? () => page.openJob({ id: data.wait.oldestJobId!, queue: oldestQueue.name }) : undefined}
            />
          ) : (
            fallback
          )}
        </Panel>
        <Panel title={t('wq.distribution.title')} hint={t('wq.distribution.hint')}>
          {!data ? (
            fallback
          ) : data.distribution.length === 0 ? (
            <PanelState status="empty" compact message={t('wq.distribution.empty')} />
          ) : (
            <BarList
              items={data.distribution.map((d) => ({
                id: d.queue,
                label: <span className="font-mono text-xs">{d.queue}</span>,
                value: d.percent,
                display: `${f.compact(d.completed)} · ${f.percent(d.percent)}`,
                tone: d.percent >= DISTRIBUTION_WARN_PERCENT && data.distribution.length > 1 ? 'warn' : undefined,
                onClick: () => page.openQueue(d.queue),
              }))}
            />
          )}
        </Panel>
        <Panel title={t('wq.report.title')}>
          {data ? (
            <ComparisonTable
              rows={[
                reportRow('received', n, null),
                reportRow('completed', n, null),
                reportRow('failed', n, true),
                reportRow('retried', n, true),
                reportRow('successRatePercent', (v) => f.percent(v), false),
                reportRow('avgProcessingMs', (v) => f.duration(v), true),
                reportRow('p95ProcessingMs', (v) => f.duration(v), true),
                reportRow('peakBacklog', n, true),
              ]}
            />
          ) : (
            fallback
          )}
        </Panel>
      </PanelGrid>

      <Panel
        title={t('wq.queue.title')}
        flush
        actions={
          <Button size="xs" variant="ghost" onClick={() => page.go('queues')}>
            {t('wq.queue.viewAll')}
            <ArrowRight />
          </Button>
        }
      >
        {data ? (
          <AvailableView source={data.queues} product={data.provider.product} className="p-3">
            {(rows) => (
              <QueueTable compact rows={[...rows].sort((a, b) => QUEUE_STATUS_RANK[a.status] - QUEUE_STATUS_RANK[b.status]).slice(0, OVERVIEW_QUEUE_LIMIT)} onOpen={(q) => page.openQueue(q)} />
            )}
          </AvailableView>
        ) : (
          <div className="p-3">{fallback}</div>
        )}
      </Panel>
    </>
  );
}

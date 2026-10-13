import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { RotateCcw } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Button, Hint } from '@core/ui/primitives';
import { AlertList, DataTable, Panel, PanelGrid, QueryView, RelativeTime, StatGrid, StatTile, StatusBanner, AvailableView } from '@core/ui/blocks';
import type { FailureReason, Failures, JobRow, WorkerAlert, WorkerRange } from '../../types/worker.types';
import { workerApi } from '../../services/worker.api';
import { FAILURE_METRICS, JOB_TABLE_MAX_HEIGHT_PX } from '../../constants/worker';
import { JobTable } from '../../components/worker/JobTable';
import { QueueMetricChart } from '../../components/worker/QueueMetricChart';
import type { QueueActionRequest } from '../../components/worker/QueueActionDialog';
import { toAlertItems } from '../../components/worker/worker-ui';
import { workerKeys } from './worker-keys';

type ByQueue = Failures['byQueue'][number];
const qCol = createColumnHelper<ByQueue>();
const rCol = createColumnHelper<FailureReason>();

interface Props {
  range: WorkerRange;
  product: string | undefined;
  /** Có → chỉ lỗi của một queue (trang chi tiết queue). */
  queue?: string;
  queues?: string[];
  onAction: (req: QueueActionRequest) => void;
  openJob: (j: Pick<JobRow, 'id' | 'queue'>) => void;
  openQueue?: (name: string) => void;
  openAlert?: (a: WorkerAlert) => void;
}

const retryTarget = (name: string, failed: number): QueueActionRequest => ({
  action: 'retry',
  target: { name, failed, waiting: 0, active: 0, delayed: 0, paused: false },
});

/**
 * Lỗi & Retry (toàn bộ hoặc một queue): số lỗi, tỷ lệ, đang retry, hồi phục, hết lượt; lỗi tăng đột biến; queue lỗi
 * nhiều nhất; lý do lỗi gộp nhóm; biểu đồ; job chờ retry; job treo (không tự retry — side effect chưa rõ); job lỗi.
 */
export function WorkerFailuresView({ range, product, queue, queues = [], onAction, openJob, openQueue, openAlert }: Props) {
  const { t } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(workerKeys.failures(range, queue), () => workerApi.failures(range, queue));
  const n = (v: number | null) => f.compact(v);
  const canRetry = query.data?.settings.retryFailed ?? false;

  const queueCols = useMemo(
    () => [
      qCol.accessor('queue', { header: t('wq.queue.name'), meta: { mono: true, truncate: true } }),
      qCol.accessor('failures', { header: t('wq.failures.failed'), cell: (c) => f.compact(c.getValue()), meta: { mono: true, align: 'right' } }),
      qCol.accessor('failed', { header: t('wq.failures.deadLetter'), cell: (c) => f.compact(c.getValue()), meta: { mono: true, align: 'right' } }),
      ...(canRetry
        ? [
            qCol.display({
              id: 'retry',
              header: '',
              cell: (c) =>
                c.row.original.failed > 0 ? (
                  <Hint content={t('wq.action.retryFailed')}>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={t('wq.action.retryFailed')}
                      onClick={(e) => (e.stopPropagation(), onAction(retryTarget(c.row.original.queue, c.row.original.failed)))}
                    >
                      <RotateCcw />
                    </Button>
                  </Hint>
                ) : null,
              meta: { align: 'right' as const, width: '44px' },
            }),
          ]
        : []),
    ],
    [t, f, canRetry, onAction],
  );

  const reasonCols = useMemo(
    () => [
      rCol.accessor('reason', { header: t('wq.failures.reason'), cell: (c) => <span className="text-crit-fg">{c.getValue()}</span>, meta: { mono: true, truncate: true, width: '46%' } }),
      rCol.accessor('count', { header: t('wq.failures.count'), cell: (c) => f.compact(c.getValue()), meta: { mono: true, align: 'right' } }),
      rCol.accessor((r) => r.queues.join(', '), { id: 'queues', header: t('wq.failures.queues'), meta: { mono: true, truncate: true } }),
      rCol.accessor('lastAt', {
        header: t('wq.failures.last'),
        cell: (c) => {
          const r = c.row.original;
          return (
            <span className="flex items-center gap-2 whitespace-nowrap">
              <RelativeTime value={r.lastAt} className="text-xs" />
              {r.sampleJobId && r.queues[0] && (
                <button
                  type="button"
                  className="font-mono text-xs text-info-fg hover:underline"
                  onClick={(e) => (e.stopPropagation(), openJob({ id: r.sampleJobId!, queue: r.queues[0]! }))}
                >
                  {f.shortId(r.sampleJobId)}
                </button>
              )}
            </span>
          );
        },
        meta: { width: '170px' },
      }),
    ],
    [t, f, openJob],
  );

  const reasonsPanel = (d: Failures) => (
    <Panel title={t('wq.failures.reasons')} hint={t('wq.failures.sampled', { count: d.sampled })} flush>
      <DataTable data={d.reasons} columns={reasonCols} getRowId={(r) => r.reason} emptyMessage={t('wq.failures.noReasons')} initialSorting={[{ id: 'count', desc: true }]} />
    </Panel>
  );

  return (
    <QueryView query={query}>
      {(d) => {
        const s = d.stats;
        return (
          <>
            <StatGrid columns={6}>
              <StatTile label={t('wq.failures.failed')} value={n(s.failed)} sub={t('wq.failures.today', { count: n(s.failedToday) })} tone={s.failed > 0 ? 'warn' : 'ok'} />
              <StatTile
                label={t('wq.failures.rate')}
                value={f.percent(s.failureRatePercent)}
                hint={t('ui.time.last', { range: t(`ui.time.ranges.${range}`) })}
                tone={(s.failureRatePercent ?? 0) > 0 ? 'warn' : s.failureRatePercent === null ? undefined : 'ok'}
              />
              <StatTile label={t('wq.failures.retrying')} value={n(s.retryingNow)} sub={t('wq.failures.retried', { count: n(s.retried) })} tone={(s.retryingNow ?? 0) > 0 ? 'warn' : undefined} />
              <StatTile label={t('wq.failures.recovered')} value={n(s.recovered)} sub={t('wq.failures.today', { count: n(s.recoveredToday) })} />
              <StatTile label={t('wq.failures.exhausted')} value={n(s.exhausted)} sub={t('wq.failures.today', { count: n(s.exhaustedToday) })} tone={s.exhausted > 0 ? 'crit' : undefined} />
              <StatTile label={t('wq.failures.deadLetter')} value={n(s.deadLetter)} hint={t('wq.failures.deadLetterHint')} tone={(s.deadLetter ?? 0) > 0 ? 'crit' : undefined} />
            </StatGrid>

            {d.spike && (
              <StatusBanner
                tone="warn"
                title={t('wq.failures.spikeTitle')}
                description={[
                  t('wq.failures.spike', {
                    from: d.spike.baselineRatePercent === null ? NO_VALUE : f.percent(d.spike.baselineRatePercent),
                    to: f.percent(d.spike.recentRatePercent),
                    min: d.spike.sinceMin,
                  }),
                  !queue && d.byQueue[0] ? t('wq.failures.topQueue', { queue: d.byQueue[0].queue }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              />
            )}

            {d.alerts.length > 0 && (
              <Panel title={t('wq.alerts.title')} className="mb-4">
                <AlertList items={toAlertItems(d.alerts, (a) => openAlert?.(a))} />
              </Panel>
            )}

            {queue ? (
              <div className="mb-4">{reasonsPanel(d)}</div>
            ) : (
              <PanelGrid layout="1-2">
                <Panel title={t('wq.failures.byQueue')} hint={t('ui.time.last', { range: t(`ui.time.ranges.${range}`) })} flush>
                  <DataTable
                    data={d.byQueue}
                    columns={queueCols}
                    getRowId={(b) => b.queue}
                    onRowClick={openQueue ? (b) => openQueue(b.queue) : undefined}
                    emptyMessage={t('wq.failures.noneByQueue')}
                  />
                </Panel>
                {reasonsPanel(d)}
              </PanelGrid>
            )}

            <QueueMetricChart range={range} title={t('wq.failures.trend')} queue={queue} queues={queues} metrics={FAILURE_METRICS} className="mb-4" />

            <Panel
              title={t('wq.retry.title')}
              hint={t('wq.retry.today', { retried: n(s.retriedToday), recovered: n(s.recoveredToday), exhausted: n(s.exhaustedToday) })}
              flush
              className="mb-4"
            >
              <AvailableView source={d.retrying} product={product} className="p-3">
                {(rows) => (
                  <JobTable
                    rows={rows}
                    columns={queue ? ['id', 'type', 'attempt', 'runAt', 'error'] : ['id', 'queue', 'type', 'attempt', 'runAt', 'error']}
                    onOpen={openJob}
                    emptyMessage={t('wq.retry.none')}
                    maxHeight={JOB_TABLE_MAX_HEIGHT_PX}
                  />
                )}
              </AvailableView>
            </Panel>

            <Panel
              title={t('wq.failed.title')}
              hint={t('wq.failed.note')}
              flush
              className="mb-4"
              actions={
                queue && canRetry && (s.deadLetter ?? 0) > 0 ? (
                  <Button size="xs" variant="secondary" onClick={() => onAction(retryTarget(queue, s.deadLetter!))}>
                    <RotateCcw />
                    {t('wq.action.retryFailed')}
                  </Button>
                ) : undefined
              }
            >
              <AvailableView source={d.failedJobs} product={product} className="p-3">
                {(rows) => (
                  <JobTable
                    rows={rows}
                    columns={queue ? ['id', 'type', 'attempt', 'time', 'error'] : ['id', 'queue', 'type', 'attempt', 'time', 'error']}
                    onOpen={openJob}
                    emptyMessage={t('wq.failed.none')}
                    maxHeight={JOB_TABLE_MAX_HEIGHT_PX}
                  />
                )}
              </AvailableView>
            </Panel>
            <Panel title={t('wq.stalled.title')} hint={`${t('wq.stalled.hint')} · ${t('wq.stalled.note')}`} flush className="mb-4">
              <AvailableView source={d.stalled} product={product} className="p-3">
                {(rows) => (
                  <JobTable
                    rows={rows}
                    columns={queue ? ['id', 'type', 'running', 'worker'] : ['id', 'queue', 'type', 'running', 'worker']}
                    onOpen={openJob}
                    emptyMessage={t('wq.stalled.none')}
                    maxHeight={JOB_TABLE_MAX_HEIGHT_PX}
                  />
                )}
              </AvailableView>
            </Panel>
          </>
        );
      }}
    </QueryView>
  );
}

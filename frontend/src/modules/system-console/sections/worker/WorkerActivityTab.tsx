import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Badge, ToggleGroup, ToggleGroupItem } from '@core/ui/primitives';
import { ActivityFeed, DataTable, Panel, PanelState, QueryView, RelativeTime, StatGrid, StatTile, type ActivityItem } from '@core/ui/blocks';
import type { WorkerAlert, WorkerEvent, WorkerOperation, WorkerOverview } from '../../types/worker.types';
import { workerApi } from '../../services/worker.api';
import { ACTIVITY_VIEWS, DELAY_REASONS, EVENT_TONE, FEED_MAX_HEIGHT_PX, JOB_TABLE_MAX_HEIGHT_PX, type ActivityView } from '../../constants/worker';
import { JobTable } from '../../components/worker/JobTable';
import { SectionGate } from '../../components/worker/SectionGate';
import { WorkerFailuresView } from './WorkerFailuresView';
import { workerKeys } from './worker-keys';
import type { WorkerPage } from './useWorkerPage';

interface Props {
  page: WorkerPage;
  data: WorkerOverview | undefined;
  openAlert: (a: WorkerAlert) => void;
  openEvent: (e: WorkerEvent) => void;
}

/** Lỗi & Hoạt động: lỗi & retry · job hẹn giờ · dòng sự kiện · lịch sử thao tác queue (`?view=`). */
export function WorkerActivityTab({ page, data, openAlert, openEvent }: Props) {
  const { t } = useLocale();
  const product = data?.provider.product;
  const queues = data?.queues.available ? data.queues.data.map((q) => q.name) : [];
  const delayedSupported = !data || data.capabilities.includes('delayed');

  const body = () => {
    switch (page.view) {
      case 'delayed':
        return delayedSupported ? (
          <DelayedView page={page} product={product} />
        ) : (
          <Panel>
            <PanelState status="no-source" message={t('wq.unsupported.message', { product: product ?? '' })} />
          </Panel>
        );
      case 'events':
        return <EventsView page={page} openEvent={openEvent} />;
      case 'operations':
        return <OperationsView />;
      default:
        return (
          <WorkerFailuresView
            range={page.range}
            product={product}
            queues={queues}
            onAction={page.requestAction}
            openJob={page.openJob}
            openQueue={(q) => page.openQueue(q, 'failures')}
            openAlert={openAlert}
          />
        );
    }
  };

  return (
    <>
      <ToggleGroup type="single" value={page.view} onValueChange={(v) => v && page.setView(v as ActivityView)} className="mb-4" aria-label={t('wq.tab.activity')}>
        {ACTIVITY_VIEWS.map((v) => (
          <ToggleGroupItem key={v} value={v}>
            {t(`wq.activity.${v}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {body()}
    </>
  );
}

/** Job hẹn giờ: tổng, lần chạy kế tiếp, lâu nhất, theo lý do (retry / lặp / hẹn giờ) — khác cron của Scheduler. */
function DelayedView({ page, product }: { page: WorkerPage; product: string | undefined }) {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(workerKeys.delayed(), () => workerApi.delayed());
  return (
    <QueryView query={query}>
      {(d) => (
        <>
          <StatGrid columns={6}>
            <StatTile label={t('wq.delayed.total')} value={f.compact(d.total)} />
            <StatTile label={t('wq.delayed.nextDue')} value={d.nextDueAt ? formatTime(d.nextDueAt, true) : NO_VALUE} sub={d.nextDueAt ? <RelativeTime value={d.nextDueAt} /> : undefined} />
            <StatTile label={t('wq.delayed.oldest')} value={d.oldestSec === null ? NO_VALUE : f.duration(d.oldestSec * 1000)} />
            {DELAY_REASONS.map((r) => (
              <StatTile key={r} label={t(`wq.delayed.reason.${r}`)} value={f.compact(d.byReason[r])} />
            ))}
          </StatGrid>
          <Panel title={t('wq.delayed.title')} hint={t('wq.delayed.note')} flush>
            <SectionGate section={d.jobs} product={product} className="p-3">
              {(rows) => (
                <JobTable
                  rows={rows}
                  columns={['id', 'queue', 'type', 'runAt', 'reason', 'attempt']}
                  onOpen={page.openJob}
                  emptyMessage={t('wq.delayed.none')}
                  maxHeight={JOB_TABLE_MAX_HEIGHT_PX}
                />
              )}
            </SectionGate>
          </Panel>
        </>
      )}
    </QueryView>
  );
}

/** Dòng sự kiện: backlog vượt ngưỡng, queue pause / resume, retry, worker restart, cảnh báo hồi phục. */
function EventsView({ page, openEvent }: { page: WorkerPage; openEvent: (e: WorkerEvent) => void }) {
  const { t } = useLocale();
  const query = useLiveQuery(workerKeys.events(page.range), () => workerApi.events(page.range));
  return (
    <Panel title={t('wq.events.title')} hint={t('ui.time.last', { range: t(`ui.time.ranges.${page.range}`) })}>
      <QueryView query={query}>
        {(events) => (
          <ActivityFeed
            items={events.map(
              (e): ActivityItem => ({
                id: e.id,
                at: e.at,
                tone: EVENT_TONE[e.severity],
                title: t(`wq.event.${e.type}`),
                detail: e.message,
                source: e.queue,
                onClick: e.queue || e.tab ? () => openEvent(e) : undefined,
              }),
            )}
            emptyMessage={t('wq.events.empty')}
            maxHeight={FEED_MAX_HEIGHT_PX}
          />
        )}
      </QueryView>
    </Panel>
  );
}

const opCol = createColumnHelper<WorkerOperation>();

/** Lịch sử thao tác queue từ Console (người thực hiện, IP đã che, kết quả) — chỉ xem. */
function OperationsView() {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const query = useLiveQuery(workerKeys.operations(), () => workerApi.operations(), { tier: 'slow' });
  const columns = useMemo(
    () => [
      opCol.accessor('at', {
        header: t('wq.audit.time'),
        cell: (c) => `${new Date(c.getValue()).toLocaleDateString()} ${formatTime(c.getValue(), true)}`,
        meta: { mono: true, width: '170px' },
      }),
      opCol.accessor('actor', {
        header: t('wq.audit.actor'),
        cell: (c) => (
          <div className="min-w-0">
            <div className="truncate">{c.getValue() ?? t('wq.audit.anonymous')}</div>
            {c.row.original.ip && <div className="font-mono text-2xs text-faint">{c.row.original.ip}</div>}
          </div>
        ),
        meta: { width: '160px' },
      }),
      opCol.accessor('action', {
        header: t('wq.audit.action'),
        cell: (c) => (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-fg">{t(`wq.audit.kind.${c.getValue()}`)}</span>
              <span className="truncate font-mono text-xs">{c.row.original.target}</span>
            </div>
            {c.row.original.detail && <div className="truncate text-xs text-faint">{c.row.original.detail}</div>}
          </div>
        ),
      }),
      opCol.accessor('result', {
        header: t('wq.audit.result'),
        cell: (c) => {
          const o = c.row.original;
          return (
            <div className="min-w-0">
              <Badge tone={o.result === 'success' ? 'ok' : 'crit'}>{t(`wq.audit.status.${o.result}`)}</Badge>
              <span className="ml-1.5 font-mono text-2xs text-faint">{f.duration(o.durationMs)}</span>
              {o.error && (
                <div className="truncate text-2xs text-crit-fg" title={o.error}>
                  {o.error}
                </div>
              )}
            </div>
          );
        },
        meta: { width: '200px' },
      }),
    ],
    [t, f, formatTime],
  );
  return (
    <Panel title={t('wq.audit.title')} hint={t('wq.audit.note')} flush>
      <QueryView query={query}>
        {(rows) => <DataTable data={rows} columns={columns} getRowId={(o) => o.id} rowTone={(o) => (o.result === 'failed' ? 'crit' : undefined)} emptyMessage={t('wq.audit.empty')} />}
      </QueryView>
    </Panel>
  );
}

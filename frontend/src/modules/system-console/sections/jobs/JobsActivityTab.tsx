import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { NO_VALUE } from '@core/lib/format';
import { Badge } from '@core/ui/primitives';
import { ActivityFeed, DataTable, Panel, QueryView, RelativeTime, type ActivityItem } from '@core/ui/blocks';
import type { JobOperation } from '../../types/jobs.types';
import { jobsApi } from '../../services/jobs.api';
import { ACTIVITY_MAX_HEIGHT_PX, EVENT_TONE } from '../../constants/jobs';
import { jobShortId } from '../../utils/jobs-format';
import { jobsKeys } from './jobs-keys';
import type { JobsPage } from './useJobsPage';

const opCol = createColumnHelper<JobOperation>();
/** `queue|id` → { queue, id }. */
const targetOf = (target: string) => {
  const i = target.indexOf('|');
  return i > 0 ? { queue: target.slice(0, i), id: target.slice(i + 1) } : null;
};

/** Hoạt động: sự kiện job (lỗi cuối, retry, phục hồi, treo, huỷ…) + audit mọi thao tác (ai, khi nào, job nào, lý do, kết quả). */
export function JobsActivityTab({ page }: { page: JobsPage }) {
  const { t } = useLocale();
  const { range, openJob } = page;
  const events = useLiveQuery(jobsKeys.events(range), () => jobsApi.events(range));
  const ops = useLiveQuery(jobsKeys.operations(), () => jobsApi.operations(), { tier: 'slow' });

  const items: ActivityItem[] = useMemo(
    () =>
      (events.data ?? []).map((e) => ({
        id: e.id,
        at: e.at,
        tone: EVENT_TONE[e.severity],
        title: `${t(`jobs.event.${e.type}`)}${e.jobType ? ` · ${e.jobType}` : ''}`,
        detail: e.message,
        source: e.jobId ? `#${jobShortId(e.jobId)}` : null,
        onClick: e.jobId ? () => openJob(e.jobId!, e.queue) : undefined,
      })),
    [events.data, t, openJob],
  );

  const columns = useMemo(
    () => [
      opCol.accessor((o) => Date.parse(o.at), { id: 'at', header: t('jobs.audit.time'), cell: (c) => <RelativeTime value={c.row.original.at} />, meta: { width: '120px' } }),
      opCol.accessor((o) => o.actor ?? '', {
        id: 'actor',
        header: t('jobs.audit.actor'),
        cell: (c) => (
          <>
            {c.row.original.actor ?? t('jobs.audit.anonymous')}
            {c.row.original.ip && <span className="ml-1.5 font-mono text-xs text-faint">{c.row.original.ip}</span>}
          </>
        ),
        meta: { truncate: true, width: '220px' },
      }),
      opCol.accessor('action', { header: t('jobs.audit.actionCol'), cell: (c) => t(`jobs.audit.action.${c.getValue()}`), meta: { width: '130px' } }),
      opCol.accessor('target', {
        header: t('jobs.audit.job'),
        cell: (c) => {
          const o = c.row.original;
          const tg = targetOf(o.target);
          return (
            <span className="flex min-w-0 items-baseline gap-1.5" title={o.detail ?? undefined}>
              <span className="font-mono text-xs">{tg ? `#${jobShortId(tg.id)}` : o.target}</span>
              {o.jobType && <span className="truncate">{o.jobType}</span>}
              {o.detail && <span className="truncate text-xs text-faint">{o.detail}</span>}
            </span>
          );
        },
        meta: { truncate: true },
        enableSorting: false,
      }),
      opCol.accessor((o) => o.reason ?? '', { id: 'reason', header: t('jobs.audit.reason'), cell: (c) => c.row.original.reason ?? NO_VALUE, meta: { truncate: true } }),
      opCol.accessor('result', {
        header: t('jobs.audit.resultCol'),
        cell: (c) => (
          <span className="inline-flex min-w-0 items-center gap-1.5" title={c.row.original.error ?? undefined}>
            <Badge tone={c.getValue() === 'success' ? 'ok' : 'crit'}>{t(`jobs.audit.result.${c.getValue()}`)}</Badge>
            {c.row.original.error && <span className="truncate text-xs text-crit-fg">{c.row.original.error}</span>}
          </span>
        ),
        meta: { width: '200px' },
      }),
    ],
    [t],
  );

  return (
    <>
      <Panel title={t('jobs.events.title')} hint={t('jobs.events.note')} className="mb-4" bodyClassName="overflow-x-auto">
        <QueryView query={events}>
          {() => (
            <ActivityFeed
              items={items}
              emptyMessage={t('jobs.events.none')}
              maxHeight={ACTIVITY_MAX_HEIGHT_PX}
            />
          )}
        </QueryView>
      </Panel>
      <Panel title={t('jobs.audit.title')} hint={t('jobs.audit.hint')} flush className="mb-4">
        <QueryView query={ops}>
          {(rows) => (
            <DataTable
              data={rows}
              columns={columns}
              getRowId={(o) => o.id}
              onRowClick={(o) => {
                const tg = targetOf(o.target);
                if (tg) openJob(tg.id, tg.queue);
              }}
              rowTone={(o) => (o.result === 'failed' ? 'crit' : undefined)}
              initialSorting={[{ id: 'at', desc: true }]}
              maxHeight={ACTIVITY_MAX_HEIGHT_PX}
              emptyMessage={t('jobs.audit.empty')}
            />
          )}
        </QueryView>
      </Panel>
    </>
  );
}

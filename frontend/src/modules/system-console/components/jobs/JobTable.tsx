import React, { useMemo } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { useTicker } from '@core/hooks/useTicker';
import { NO_VALUE } from '@core/lib/format';
import { RELATIVE_TIME_TICK_MS } from '@core/constants/ui.constants';
import { Badge } from '@core/ui/primitives';
import { DataTable, RelativeTime, type DataTableProps } from '@core/ui/blocks';
import type { JobRow } from '../../types/jobs.types';
import type { JobColumn } from '../../constants/jobs';
import { attemptsLabel, instanceLabel, jobDuration, jobKey, jobShortId, msUntil, sourceDetail } from '../../utils/jobs-format';
import { JobProgress, JobStatusBadge } from './JobStatus';

const col = createColumnHelper<JobRow>();

export interface JobSelection {
  selected: ReadonlySet<string>;
  onToggle: (j: JobRow) => void;
  onToggleAll: (rows: JobRow[], on: boolean) => void;
  canSelect: (j: JobRow) => boolean;
}

interface JobTableProps extends Pick<DataTableProps<JobRow>, 'maxHeight' | 'virtual' | 'loadMore' | 'footer' | 'emptyMessage' | 'className'> {
  rows: JobRow[];
  columns: JobColumn[];
  onOpen: (j: JobRow) => void;
  /** Chọn nhiều (retry hàng loạt job lỗi). */
  selection?: JobSelection;
}

const Sub = ({ children, warn }: { children: React.ReactNode; warn?: boolean }) => (
  <span className={warn ? 'ml-1.5 text-xs text-warn-fg' : 'ml-1.5 text-xs text-faint'}>{children}</span>
);

/** Bảng job: cột theo trạng thái, bấm hàng → Job Detail, hàng treo / lỗi có viền tông. */
export function JobTable({ rows, columns, onOpen, selection, ...table }: JobTableProps) {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const now = useTicker(RELATIVE_TIME_TICK_MS);

  const defs = useMemo(() => {
    const all: Record<JobColumn, ColumnDef<JobRow, unknown>> = {
      id: col.accessor('id', {
        header: t('jobs.col.id'),
        cell: (c) => <span title={c.getValue()}>#{jobShortId(c.getValue())}</span>,
        meta: { mono: true, width: '128px' },
        enableSorting: false,
      }) as ColumnDef<JobRow, unknown>,
      type: col.accessor('type', { header: t('jobs.col.type'), cell: (c) => <span className="font-medium text-fg">{c.getValue()}</span>, meta: { truncate: true } }) as ColumnDef<JobRow, unknown>,
      queue: col.accessor('queue', { header: t('jobs.col.queue'), meta: { mono: true, truncate: true, width: '120px' } }) as ColumnDef<JobRow, unknown>,
      status: col.accessor('status', {
        header: t('jobs.col.status'),
        cell: (c) => (
          <span className="inline-flex items-center gap-1.5">
            <JobStatusBadge status={c.getValue()} />
            {c.row.original.longRunning && <Badge tone="warn" size="xs">{t('jobs.flag.longRunning')}</Badge>}
            {c.row.original.longWait && <Badge tone="warn" size="xs">{t('jobs.flag.longWait')}</Badge>}
          </span>
        ),
        meta: { width: '150px' },
      }) as ColumnDef<JobRow, unknown>,
      wait: col.accessor((j) => (j.status === 'delayed' ? null : j.waitMs), {
        id: 'wait',
        header: t('jobs.col.wait'),
        cell: (c) => <span className={c.row.original.longWait ? 'text-warn-fg' : undefined}>{f.duration(c.getValue() as number | null)}</span>,
        meta: { align: 'right', mono: true, width: '96px' },
      }) as ColumnDef<JobRow, unknown>,
      duration: col.accessor((j) => jobDuration(j), { id: 'duration', header: t('jobs.col.duration'), cell: (c) => f.duration(c.getValue() as number | null), meta: { align: 'right', mono: true, width: '96px' } }) as ColumnDef<JobRow, unknown>,
      attempts: col.accessor('attempts', { header: t('jobs.col.attempts'), cell: (c) => attemptsLabel(c.row.original), meta: { align: 'right', mono: true, width: '84px' } }) as ColumnDef<JobRow, unknown>,
      created: col.accessor((j) => Date.parse(j.createdAt), { id: 'created', header: t('jobs.col.created'), cell: (c) => formatTime(c.row.original.createdAt, true), meta: { mono: true, width: '96px' } }) as ColumnDef<JobRow, unknown>,
      source: col.accessor((j) => j.source.kind, {
        id: 'source',
        header: t('jobs.col.source'),
        cell: (c) => {
          const d = sourceDetail(c.row.original.source);
          return (
            <>
              {t(`jobs.source.${c.row.original.source.kind}`)}
              {d && <Sub>{d}</Sub>}
            </>
          );
        },
        meta: { truncate: true },
      }) as ColumnDef<JobRow, unknown>,
      worker: col.accessor((j) => j.worker ?? '', {
        id: 'worker',
        header: t('jobs.col.worker'),
        cell: (c) => (c.row.original.worker ? instanceLabel(c.row.original.worker) : NO_VALUE),
        meta: { mono: true, truncate: true },
      }) as ColumnDef<JobRow, unknown>,
      priority: col.accessor('priority', {
        header: t('jobs.col.priority'),
        cell: (c) => (c.getValue() ? `${t(`jobs.priority.${c.row.original.priorityLevel}`)} (${c.getValue()})` : t('jobs.priority.normal')),
        meta: { width: '120px' },
      }) as ColumnDef<JobRow, unknown>,
      running: col.accessor('runningMs', {
        header: t('jobs.col.running'),
        cell: (c) => {
          const j = c.row.original;
          return (
            <span className={j.longRunning || j.status === 'stalled' ? 'text-warn-fg' : undefined}>
              {f.duration(j.runningMs)}
              {j.longRunning && j.typicalMs !== null && <Sub>{t('jobs.typical', { value: f.duration(j.typicalMs) })}</Sub>}
            </span>
          );
        },
        meta: { align: 'right', mono: true, width: '136px' },
      }) as ColumnDef<JobRow, unknown>,
      progress: col.accessor((j) => j.progress?.percent ?? null, {
        id: 'progress',
        header: t('jobs.col.progress'),
        cell: (c) => (c.getValue() === null ? NO_VALUE : <JobProgress job={c.row.original} />),
        meta: { width: '120px' },
      }) as ColumnDef<JobRow, unknown>,
      heartbeat: col.accessor('heartbeatAgeSec', {
        header: t('jobs.col.heartbeat'),
        cell: (c) =>
          c.getValue() !== null ? (
            t('jobs.heartbeatAgo', { value: f.duration((c.getValue() as number) * 1000) })
          ) : (
            <span className="text-warn-fg">{t('jobs.noHeartbeat')}</span>
          ),
        meta: { align: 'right', mono: true, width: '120px' },
      }) as ColumnDef<JobRow, unknown>,
      runAt: col.accessor((j) => (j.availableAt ? Date.parse(j.availableAt) : null), {
        id: 'runAt',
        header: t('jobs.col.runAt'),
        cell: (c) => {
          const at = c.row.original.availableAt;
          if (!at) return NO_VALUE;
          return (
            <>
              {formatTime(at, true)}
              <Sub>{t('jobs.runsIn', { value: f.duration(msUntil(at, now)) })}</Sub>
            </>
          );
        },
        meta: { mono: true, width: '190px' },
      }) as ColumnDef<JobRow, unknown>,
      reason: col.accessor('delayReason', {
        header: t('jobs.col.reason'),
        cell: (c) => (c.getValue() ? t(`jobs.delayReason.${c.getValue()}`) : NO_VALUE),
        meta: { width: '120px' },
      }) as ColumnDef<JobRow, unknown>,
      error: col.accessor((j) => j.errorType ?? '', {
        id: 'error',
        header: t('jobs.col.error'),
        cell: (c) => {
          const j = c.row.original;
          if (!j.errorType) return NO_VALUE;
          return (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <span className={j.status === 'failed' ? 'truncate font-mono text-xs text-crit-fg' : 'truncate font-mono text-xs'} title={j.error ?? j.errorType}>
                {j.errorType}
              </span>
              {j.retryable === false && <Badge tone="warn" size="xs">{t('jobs.retryable.no')}</Badge>}
            </span>
          );
        },
        meta: { truncate: true },
      }) as ColumnDef<JobRow, unknown>,
      finished: col.accessor((j) => (j.finishedAt ? Date.parse(j.finishedAt) : null), {
        id: 'finished',
        header: t('jobs.col.finished'),
        cell: (c) => <RelativeTime value={c.row.original.finishedAt} />,
        meta: { width: '120px' },
      }) as ColumnDef<JobRow, unknown>,
      cancelled: col.accessor((j) => (j.cancelledAt ? Date.parse(j.cancelledAt) : null), {
        id: 'cancelled',
        header: t('jobs.col.cancelled'),
        cell: (c) => (
          <>
            <RelativeTime value={c.row.original.cancelledAt} />
            {c.row.original.cancelledBy && <Sub>{c.row.original.cancelledBy}</Sub>}
          </>
        ),
        meta: { width: '180px' },
      }) as ColumnDef<JobRow, unknown>,
    };
    return all;
  }, [t, f, formatTime, now]);

  const columnDefs = useMemo(() => {
    const list = columns.map((c) => defs[c]);
    if (!selection) return list;
    const selectable = rows.filter(selection.canSelect);
    const allOn = selectable.length > 0 && selectable.every((j) => selection.selected.has(jobKey(j)));
    const select: ColumnDef<JobRow, unknown> = col.display({
      id: 'select',
      header: () => (
        <input
          type="checkbox"
          className="size-3.5 accent-primary"
          aria-label={t('jobs.select.all')}
          checked={allOn}
          disabled={!selectable.length}
          onChange={(e) => selection.onToggleAll(selectable, e.target.checked)}
        />
      ),
      cell: (c) => (
        <input
          type="checkbox"
          className="size-3.5 accent-primary"
          aria-label={t('jobs.select.one', { id: jobShortId(c.row.original.id) })}
          disabled={!selection.canSelect(c.row.original)}
          checked={selection.selected.has(jobKey(c.row.original))}
          onClick={(e) => e.stopPropagation()}
          onChange={() => selection.onToggle(c.row.original)}
        />
      ),
      meta: { width: '36px' },
    }) as ColumnDef<JobRow, unknown>;
    return [select, ...list];
  }, [columns, defs, selection, rows, t]);

  return (
    <DataTable
      data={rows}
      columns={columnDefs}
      getRowId={jobKey}
      onRowClick={onOpen}
      rowTone={(j) => (j.status === 'stalled' ? 'warn' : j.status === 'failed' ? 'crit' : undefined)}
      {...table}
    />
  );
}

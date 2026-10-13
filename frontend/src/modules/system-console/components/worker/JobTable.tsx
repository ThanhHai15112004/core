import React, { useMemo } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Badge } from '@core/ui/primitives';
import { DataTable, RelativeTime } from '@core/ui/blocks';
import type { JobRow } from '../../types/worker.types';
import { JOB_STATE_TONE } from '../../constants/worker';
import { instanceLabel } from '../../utils/worker-format';

export type JobColumn = 'id' | 'queue' | 'type' | 'state' | 'attempt' | 'duration' | 'running' | 'runAt' | 'reason' | 'worker' | 'error' | 'time';

const col = createColumnHelper<JobRow>();

interface Props {
  rows: JobRow[];
  columns: JobColumn[];
  onOpen?: (job: JobRow) => void;
  emptyMessage: string;
  maxHeight?: number;
  footer?: React.ReactNode;
}

/** Bảng job (tóm tắt) — bấm job → Job Detail ở trang Jobs (vòng đời, lần thử, lỗi, retry / huỷ). */
export function JobTable({ rows, columns, onOpen, emptyMessage, maxHeight, footer }: Props) {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const defs = useMemo(() => {
    const all: Record<JobColumn, ColumnDef<JobRow, unknown>> = {
      id: col.accessor('id', {
        header: t('wq.job.col.id'),
        cell: (c) => <span title={c.getValue()}>{f.shortId(c.getValue())}</span>,
        meta: { mono: true, width: '120px' },
      }) as ColumnDef<JobRow, unknown>,
      queue: col.accessor('queue', { header: t('wq.job.col.queue'), meta: { mono: true, truncate: true } }) as ColumnDef<JobRow, unknown>,
      type: col.accessor('name', { id: 'type', header: t('wq.job.col.type'), meta: { mono: true, truncate: true } }) as ColumnDef<JobRow, unknown>,
      state: col.accessor('state', {
        header: t('wq.job.col.state'),
        cell: (c) => <Badge tone={JOB_STATE_TONE[c.getValue()]}>{t(`wq.job.state.${c.getValue()}`)}</Badge>,
        meta: { width: '110px' },
      }) as ColumnDef<JobRow, unknown>,
      attempt: col.accessor('attempts', {
        id: 'attempt',
        header: t('wq.job.col.attempt'),
        cell: (c) => `${c.getValue()}/${c.row.original.maxAttempts}`,
        meta: { mono: true, align: 'right', width: '80px' },
      }) as ColumnDef<JobRow, unknown>,
      duration: col.accessor((j) => (j.state === 'active' ? j.runningMs : j.durationMs), {
        id: 'duration',
        header: t('wq.job.col.duration'),
        cell: (c) => f.duration(c.getValue()),
        meta: { mono: true, align: 'right', width: '96px' },
      }) as ColumnDef<JobRow, unknown>,
      running: col.accessor('runningMs', {
        id: 'running',
        header: t('wq.job.col.running'),
        cell: (c) => f.duration(c.getValue()),
        meta: { mono: true, align: 'right', width: '96px' },
      }) as ColumnDef<JobRow, unknown>,
      runAt: col.accessor('runAt', {
        header: t('wq.job.col.runAt'),
        cell: (c) =>
          c.getValue() ? (
            <span className="whitespace-nowrap">
              {formatTime(c.getValue()!, true)} <RelativeTime value={c.getValue()} className="text-faint" />
            </span>
          ) : (
            NO_VALUE
          ),
        meta: { mono: true, width: '190px' },
      }) as ColumnDef<JobRow, unknown>,
      reason: col.accessor('delayReason', {
        id: 'reason',
        header: t('wq.job.col.reason'),
        cell: (c) => (c.getValue() ? t(`wq.delayed.reason.${c.getValue()}`) : NO_VALUE),
        meta: { width: '110px' },
      }) as ColumnDef<JobRow, unknown>,
      worker: col.accessor('worker', {
        header: t('wq.job.col.worker'),
        cell: (c) => (c.getValue() ? instanceLabel(c.getValue()!) : NO_VALUE),
        meta: { mono: true, truncate: true },
      }) as ColumnDef<JobRow, unknown>,
      error: col.accessor('error', {
        header: t('wq.job.col.error'),
        cell: (c) => (c.getValue() ? <span className="text-crit-fg">{c.getValue()}</span> : NO_VALUE),
        meta: { truncate: true, width: '32%' },
      }) as ColumnDef<JobRow, unknown>,
      time: col.accessor((j) => j.finishedAt ?? j.processedAt ?? j.createdAt, {
        id: 'time',
        header: t('wq.job.col.time'),
        cell: (c) => formatTime(c.getValue(), true),
        meta: { mono: true, width: '96px' },
      }) as ColumnDef<JobRow, unknown>,
    };
    return columns.map((c) => all[c]);
  }, [columns, t, f, formatTime]);

  return (
    <DataTable
      data={rows}
      columns={defs}
      getRowId={(j) => `${j.queue}:${j.id}`}
      onRowClick={onOpen}
      rowTone={(j) => (j.state === 'failed' ? 'crit' : j.state === 'retrying' ? 'warn' : undefined)}
      emptyMessage={emptyMessage}
      maxHeight={maxHeight}
      footer={footer}
    />
  );
}

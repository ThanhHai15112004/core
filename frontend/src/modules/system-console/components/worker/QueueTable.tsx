import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { Badge } from '@core/ui/primitives';
import { DataTable } from '@core/ui/blocks';
import type { QueueRow } from '../../types/worker.types';
import { GROWTH_NOTE_MIN_PER_MIN, QUEUE_STATUS_RANK, QUEUE_STATUS_TONE } from '../../constants/worker';
import { attentionTone, signedRate } from './worker-ui';

const col = createColumnHelper<QueueRow>();
const isBacklog = (q: QueueRow) => q.status === 'backlog' || q.status === 'no_consumer';

interface Props {
  rows: QueueRow[];
  onOpen: (name: string) => void;
  /** Bảng rút gọn (Tổng quan): bỏ cột phụ. */
  compact?: boolean;
  emptyMessage?: string;
}

/** Bảng queue: chờ (kèm lâu nhất), đang chạy, hẹn giờ, lỗi (kèm tỷ lệ), tốc độ xử lý (kèm đang tăng), P95, trạng thái. */
export function QueueTable({ rows, onOpen, compact, emptyMessage }: Props) {
  const { t } = useLocale();
  const f = useFormat();
  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: t('wq.queue.name'),
        cell: (c) => {
          const q = c.row.original;
          const meta = [q.workers === null ? null : t('wq.queue.workersN', { count: q.workers }), q.concurrency > 0 ? t('wq.queue.concurrencyN', { count: q.concurrency }) : null]
            .filter(Boolean)
            .join(' · ');
          return (
            <div className="min-w-0">
              <div className="truncate font-mono text-xs text-fg">{q.name}</div>
              {!compact && meta && <div className="truncate text-2xs text-faint">{meta}</div>}
            </div>
          );
        },
      }),
      col.accessor((q) => QUEUE_STATUS_RANK[q.status], {
        id: 'status',
        header: t('wq.queue.status'),
        cell: (c) => <Badge tone={QUEUE_STATUS_TONE[c.row.original.status]}>{t(`wq.queue.statusOf.${c.row.original.status}`)}</Badge>,
        meta: { width: '130px' },
      }),
      col.accessor('waiting', {
        header: t('wq.queue.waiting'),
        cell: (c) => {
          const q = c.row.original;
          return (
            <div>
              <div className={isBacklog(q) ? 'text-warn-fg' : undefined}>{f.compact(q.waiting)}</div>
              {!compact && q.oldestWaitingSec !== null && <div className="text-2xs text-faint">{t('wq.queue.oldestShort', { age: f.uptime(q.oldestWaitingSec) })}</div>}
            </div>
          );
        },
        meta: { mono: true, align: 'right' },
      }),
      col.accessor('active', { header: t('wq.queue.active'), cell: (c) => f.compact(c.getValue()), meta: { mono: true, align: 'right' } }),
      ...(compact ? [] : [col.accessor('delayed', { header: t('wq.queue.delayed'), cell: (c) => f.compact(c.getValue()), meta: { mono: true, align: 'right' as const } })]),
      col.accessor('failed', {
        header: t('wq.queue.failed'),
        cell: (c) => {
          const q = c.row.original;
          return (
            <div>
              <div className={q.failed > 0 ? 'text-crit-fg' : undefined}>{f.compact(q.failed)}</div>
              {q.failureRatePercent !== null && q.failureRatePercent > 0 && <div className="text-2xs text-faint">{f.percent(q.failureRatePercent)}</div>}
            </div>
          );
        },
        meta: { mono: true, align: 'right' },
      }),
      col.accessor((q) => q.processingPerMin ?? -1, {
        id: 'rate',
        header: t('wq.queue.rate'),
        cell: (c) => {
          const q = c.row.original;
          const growing = q.growthPerMin !== null && q.growthPerMin > GROWTH_NOTE_MIN_PER_MIN && q.waiting > 0;
          return (
            <div>
              <div>{f.rate(q.processingPerMin, 'min')}</div>
              {growing && <div className="text-2xs text-warn-fg">{t('wq.queue.growing', { rate: signedRate(f, q.growthPerMin) })}</div>}
            </div>
          );
        },
        meta: { mono: true, align: 'right' },
      }),
      ...(compact
        ? []
        : [
            col.accessor((q) => q.p95Ms ?? -1, {
              id: 'p95',
              header: t('wq.common.p95'),
              cell: (c) => f.duration(c.row.original.p95Ms),
              meta: { mono: true, align: 'right' as const },
            }),
          ]),
    ],
    [t, f, compact],
  );
  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(q) => q.name}
      onRowClick={(q) => onOpen(q.name)}
      rowTone={(q) => attentionTone(QUEUE_STATUS_TONE[q.status])}
      initialSorting={[{ id: 'status', desc: false }]}
      emptyMessage={emptyMessage ?? t('wq.queue.empty')}
    />
  );
}

import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { cn } from '@core/lib/cn';
import { Badge } from '@core/ui/primitives';
import { DataTable } from '@core/ui/blocks';
import type { ConsumerRow } from '../../types/messaging.types';
import { CONSUMER_STATUS_RANK, CONSUMER_STATUS_TONE } from '../../constants/messaging';
import { formatMsgRate } from '../../utils/messaging-format';

const col = createColumnHelper<ConsumerRow>();

interface Props {
  rows: ConsumerRow[];
  onOpen: (name: string) => void;
  activeId?: string | null;
  emptyMessage: string;
}

/** Bảng consumer: tốc độ, lag của queue, P95 xử lý, lỗi, instance, trạng thái. */
export function ConsumerTable({ rows, onOpen, activeId, emptyMessage }: Props) {
  const { t } = useLocale();
  const f = useFormat();
  const columns = useMemo(
    () => [
      col.accessor('consumer', {
        header: t('messaging.consumer.name'),
        cell: (c) => {
          const r = c.row.original;
          return (
            <div className="min-w-0">
              <div className="truncate font-mono text-xs text-fg">{c.getValue()}</div>
              <div className="truncate text-2xs text-faint">
                {r.queue}
                {r.runtime && ` · ${t(`rt.name.${r.runtime}`)}`}
              </div>
            </div>
          );
        },
      }),
      col.accessor((r) => r.perSec ?? -1, {
        id: 'rate',
        header: t('messaging.consumer.rate'),
        cell: (c) => formatMsgRate(c.row.original.perSec, f.locale),
        meta: { align: 'right', mono: true },
      }),
      col.accessor((r) => r.lag ?? -1, {
        id: 'lag',
        header: t('messaging.consumer.lag'),
        cell: (c) => <span className={cn((c.row.original.lag ?? 0) > 0 && 'text-warn-fg')}>{f.compact(c.row.original.lag)}</span>,
        meta: { align: 'right', mono: true },
      }),
      col.accessor((r) => r.p95Ms ?? -1, {
        id: 'p95',
        header: t('messaging.processing.p95'),
        cell: (c) => f.duration(c.row.original.p95Ms),
        meta: { align: 'right', mono: true },
      }),
      col.accessor((r) => r.failed ?? -1, {
        id: 'failed',
        header: t('messaging.consumer.failures'),
        cell: (c) => {
          const r = c.row.original;
          return (
            <span className={cn((r.failed ?? 0) > 0 ? 'text-warn-fg' : 'text-faint')}>
              {f.compact(r.failed)}
              {r.failureRatePercent !== null && (r.failed ?? 0) > 0 && <span className="ml-1 text-2xs text-faint">{f.percent(r.failureRatePercent)}</span>}
            </span>
          );
        },
        meta: { align: 'right', mono: true },
      }),
      col.accessor((r) => r.instances.length, {
        id: 'instances',
        header: t('messaging.consumer.instances'),
        cell: (c) => (
          <span>
            {c.getValue()}
            <span className="ml-1 text-2xs text-faint">{t('messaging.consumer.concurrency', { n: c.row.original.instances.reduce((s, i) => s + i.concurrency, 0) })}</span>
          </span>
        ),
        meta: { align: 'right', mono: true },
      }),
      col.accessor((r) => CONSUMER_STATUS_RANK[r.status], {
        id: 'status',
        header: t('messaging.channel.status'),
        cell: (c) => <Badge tone={CONSUMER_STATUS_TONE[c.row.original.status]}>{t(`messaging.consumer.statusOf.${c.row.original.status}`)}</Badge>,
      }),
    ],
    [t, f],
  );
  const activeRow = activeId ? rows.find((r) => r.consumer === activeId) : undefined;
  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => `${r.consumer}:${r.queue}`}
      onRowClick={(r) => onOpen(r.consumer)}
      activeRowId={activeRow ? `${activeRow.consumer}:${activeRow.queue}` : null}
      rowTone={(r) => CONSUMER_STATUS_TONE[r.status]}
      initialSorting={[{ id: 'status', desc: true }]}
      emptyMessage={emptyMessage}
    />
  );
}

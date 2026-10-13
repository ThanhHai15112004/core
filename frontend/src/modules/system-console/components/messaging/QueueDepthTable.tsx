import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { cn } from '@core/lib/cn';
import { Badge } from '@core/ui/primitives';
import { DataTable } from '@core/ui/blocks';
import type { QueueRow } from '../../types/messaging.types';
import { formatAge } from '../../utils/messaging-format';

const col = createColumnHelper<QueueRow>();
const noConsumer = (q: QueueRow) => q.waiting > 0 && q.workers === 0;

/** Độ sâu queue trên broker: chờ, đang xử lý, hẹn giờ / retry, dead letter, tuổi message cũ nhất, worker. */
export function QueueDepthTable({ rows, emptyMessage }: { rows: QueueRow[]; emptyMessage: string }) {
  const { t } = useLocale();
  const f = useFormat();
  const columns = useMemo(
    () => [
      col.accessor('name', {
        header: t('messaging.queue.name'),
        cell: (c) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-xs text-fg">{c.getValue()}</span>
            {c.row.original.paused && (
              <Badge tone="warn" size="xs">
                {t('messaging.queue.paused')}
              </Badge>
            )}
          </span>
        ),
      }),
      col.accessor('waiting', {
        header: t('messaging.queue.waiting'),
        cell: (c) => <span className={cn(c.getValue() > 0 && 'text-warn-fg')}>{f.compact(c.getValue())}</span>,
        meta: { align: 'right', mono: true },
      }),
      col.accessor('active', { header: t('messaging.queue.active'), cell: (c) => f.compact(c.getValue()), meta: { align: 'right', mono: true } }),
      col.accessor('delayed', { header: t('messaging.queue.delayed'), cell: (c) => f.compact(c.getValue()), meta: { align: 'right', mono: true } }),
      col.accessor('failed', {
        header: t('messaging.queue.failed'),
        cell: (c) => <span className={cn(c.getValue() > 0 ? 'text-crit-fg' : 'text-faint')}>{f.compact(c.getValue())}</span>,
        meta: { align: 'right', mono: true },
      }),
      col.accessor((q) => q.oldestWaitingSec ?? -1, {
        id: 'oldest',
        header: t('messaging.queue.oldest'),
        cell: (c) => formatAge(c.row.original.oldestWaitingSec),
        meta: { align: 'right', mono: true },
      }),
      col.accessor((q) => q.workers ?? -1, {
        id: 'workers',
        header: t('messaging.queue.consumers'),
        cell: (c) => {
          const q = c.row.original;
          if (noConsumer(q)) return <Badge tone="crit">{t('messaging.queue.noConsumer')}</Badge>;
          return (
            <span className="flex min-w-0 items-baseline gap-1.5" title={q.consumers.join(', ')}>
              <span className="font-mono text-xs">{f.number(q.workers)}</span>
              {q.consumers.length > 0 && <span className="max-w-48 truncate text-2xs text-faint">{q.consumers.join(', ')}</span>}
            </span>
          );
        },
      }),
    ],
    [t, f],
  );
  return <DataTable data={rows} columns={columns} getRowId={(q) => q.name} rowTone={(q) => (noConsumer(q) ? 'crit' : undefined)} emptyMessage={emptyMessage} />;
}

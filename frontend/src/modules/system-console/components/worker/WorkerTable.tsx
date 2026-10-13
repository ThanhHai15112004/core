import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Badge } from '@core/ui/primitives';
import { DataTable } from '@core/ui/blocks';
import type { WorkerRow } from '../../types/worker.types';
import { WORKER_STATUS_TONE } from '../../constants/worker';
import { instanceLabel } from '../../utils/worker-format';
import { attentionTone } from './worker-ui';

const col = createColumnHelper<WorkerRow>();

interface Props {
  rows: WorkerRow[];
  onOpen: (id: string) => void;
  activeId?: string | null;
  emptyMessage: string;
}

/** Worker instance: trạng thái, job đang chạy / concurrency, CPU, bộ nhớ, uptime, queue tiêu thụ. */
export function WorkerTable({ rows, onOpen, activeId, emptyMessage }: Props) {
  const { t } = useLocale();
  const f = useFormat();
  const columns = useMemo(
    () => [
      col.accessor('id', {
        header: t('wq.worker.name'),
        cell: (c) => (
          <div className="min-w-0">
            <div className="truncate font-mono text-xs text-fg" title={c.getValue()}>
              {instanceLabel(c.getValue())}
            </div>
            <div className="truncate text-2xs text-faint">{c.row.original.runtime ? t(`rt.name.${c.row.original.runtime}`) : NO_VALUE}</div>
          </div>
        ),
      }),
      col.accessor('status', {
        header: t('wq.worker.status'),
        cell: (c) => <Badge tone={WORKER_STATUS_TONE[c.getValue()]}>{t(`wq.worker.statusOf.${c.getValue()}`)}</Badge>,
        meta: { width: '130px' },
      }),
      col.accessor((w) => w.utilizationPercent ?? -1, {
        id: 'active',
        header: t('wq.worker.active'),
        cell: (c) => {
          const w = c.row.original;
          return (
            <div>
              <div className={(w.active ?? 0) > w.concurrency ? 'text-crit-fg' : undefined}>
                {w.active ?? NO_VALUE} / {w.concurrency}
              </div>
              {w.utilizationPercent !== null && <div className="text-2xs text-faint">{f.percent(w.utilizationPercent)}</div>}
            </div>
          );
        },
        meta: { mono: true, align: 'right' },
      }),
      col.accessor((w) => w.cpuPercent ?? -1, {
        id: 'cpu',
        header: t('wq.worker.cpu'),
        cell: (c) => <span className={c.row.original.status === 'high_cpu' ? 'text-warn-fg' : undefined}>{f.percent(c.row.original.cpuPercent)}</span>,
        meta: { mono: true, align: 'right' },
      }),
      col.accessor((w) => w.memoryMb ?? -1, {
        id: 'memory',
        header: t('wq.worker.memory'),
        cell: (c) => {
          const w = c.row.original;
          return (
            <div className="whitespace-nowrap">
              <div className={w.status === 'high_memory' ? 'text-warn-fg' : undefined}>{f.mb(w.memoryMb)}</div>
              {w.memoryLimitMb !== null && <div className="text-2xs text-faint">/ {f.mb(w.memoryLimitMb)}</div>}
            </div>
          );
        },
        meta: { mono: true, align: 'right' },
      }),
      col.accessor('uptimeSec', { header: t('wq.worker.uptime'), cell: (c) => f.uptime(c.getValue()), meta: { mono: true, align: 'right' } }),
      col.accessor((w) => w.queues.join(', '), { id: 'queues', header: t('wq.worker.queues'), meta: { mono: true, truncate: true, width: '28%' } }),
    ],
    [t, f],
  );
  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(w) => w.id}
      onRowClick={(w) => onOpen(w.id)}
      activeRowId={activeId}
      rowTone={(w) => attentionTone(WORKER_STATUS_TONE[w.status])}
      emptyMessage={emptyMessage}
    />
  );
}

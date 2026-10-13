import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { DataTable, RelativeTime } from '@core/ui/blocks';
import type { ContainerRow } from '../../types/storage.types';
import { useContainerLabel } from './useContainerLabel';

const col = createColumnHelper<ContainerRow>();

interface ContainerTableProps {
  rows: ContainerRow[];
  onOpen: (row: ContainerRow) => void;
  activeName?: string | null;
  emptyMessage: string;
  /** Chỉ cột chính (Tổng quan). */
  compact?: boolean;
}

/** Bảng container (prefix cấp 1 trong bucket / thư mục gốc): object, dung lượng, tăng 24h, lỗi — sort theo header. */
export function ContainerTable({ rows, onOpen, activeName, emptyMessage, compact }: ContainerTableProps) {
  const { t } = useLocale();
  const f = useFormat();
  const label = useContainerLabel();
  const columns = useMemo(
    () => [
      col.accessor('name', { header: t('storage.container.name'), cell: (c) => <span className="font-mono text-xs text-fg">{label(c.getValue())}</span>, meta: { truncate: true } }),
      col.accessor('objects', { header: t('storage.container.objects'), cell: (c) => f.compact(c.getValue()), meta: { align: 'right', mono: true, width: '90px' } }),
      col.accessor('bytes', { header: t('storage.container.size'), cell: (c) => f.bytes(c.getValue()), meta: { align: 'right', mono: true, width: '100px' } }),
      col.accessor((r) => r.growth24hBytes ?? Number.NEGATIVE_INFINITY, {
        id: 'growth',
        header: t('storage.container.growth'),
        cell: (c) => f.signedBytes(c.row.original.growth24hBytes),
        meta: { align: 'right', mono: true, width: '110px' },
      }),
      ...(compact
        ? []
        : [
            col.accessor('createdToday', { header: t('storage.container.createdToday'), cell: (c) => f.compact(c.getValue()), meta: { align: 'right', mono: true, width: '100px' } }),
            col.accessor('newest', {
              header: t('storage.container.newest'),
              cell: (c) => <RelativeTime value={c.getValue()} className="text-xs text-muted" />,
              meta: { align: 'right', width: '120px' },
            }),
          ]),
      col.accessor('errors', {
        header: t('storage.container.errors'),
        cell: (c) => <span className={c.getValue() > 0 ? 'text-crit-fg' : 'text-faint'}>{f.number(c.getValue())}</span>,
        meta: { align: 'right', mono: true, width: '70px' },
      }),
    ],
    [t, f, label, compact],
  );
  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.name}
      onRowClick={onOpen}
      activeRowId={activeName ?? undefined}
      rowTone={(r) => (r.errors > 0 ? 'warn' : undefined)}
      initialSorting={compact ? [] : [{ id: 'bytes', desc: true }]}
      emptyMessage={emptyMessage}
    />
  );
}

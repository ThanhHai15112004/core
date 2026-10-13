import React, { useMemo } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { cn } from '@core/lib/cn';
import { Badge } from '@core/ui/primitives';
import { DataTable, RelativeTime, type DataTableProps } from '@core/ui/blocks';
import type { MessageRow } from '../../types/messaging.types';
import { MESSAGE_STATUS_TONE } from '../../constants/messaging';
import { messageRowId } from '../../utils/messaging-format';

export type MessageColumn = 'time' | 'id' | 'channel' | 'status' | 'attempts' | 'next' | 'duration' | 'error' | 'size';

const col = createColumnHelper<MessageRow>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Col = ColumnDef<MessageRow, any>;
const when = (m: MessageRow) => m.finishedAt ?? m.processedAt ?? m.publishedAt;

interface Props extends Pick<DataTableProps<MessageRow>, 'footer' | 'loadMore' | 'maxHeight' | 'virtual'> {
  rows: MessageRow[];
  onOpen: (m: MessageRow) => void;
  columns?: MessageColumn[];
  emptyMessage: string;
  activeId?: string | null;
  /** Nút thao tác cuối hàng (retry / replay / discard). */
  actions?: (m: MessageRow) => React.ReactNode;
}

/** Bảng message dùng chung (explorer, retry, dead letter, drawer) — cột chọn theo ngữ cảnh. */
export function MessageTable({ rows, onOpen, columns = ['time', 'id', 'channel', 'status', 'duration', 'size'], emptyMessage, activeId, actions, ...rest }: Props) {
  const { t, formatTime } = useLocale();
  const f = useFormat();
  const colKey = columns.join(',');
  const defs = useMemo(() => {
    const all: Record<MessageColumn, Col> = {
      time: col.accessor((m) => Date.parse(when(m)), {
        id: 'time',
        header: t('messaging.message.time'),
        cell: (c) => formatTime(when(c.row.original), true),
        meta: { mono: true, width: '96px' },
      }),
      id: col.accessor('id', {
        header: t('messaging.message.id'),
        cell: (c) => (
          <span className="whitespace-nowrap font-mono text-xs text-fg" title={c.getValue()}>
            {f.shortId(c.getValue())}
          </span>
        ),
      }),
      channel: col.accessor('channel', {
        header: t('messaging.message.channel'),
        cell: (c) => (
          <div className="min-w-0">
            <div className="truncate font-mono text-xs">{c.getValue()}</div>
            {c.row.original.producer && <div className="truncate text-2xs text-faint">{t('messaging.message.from', { producer: t(`rt.name.${c.row.original.producer}`) })}</div>}
          </div>
        ),
      }),
      status: col.accessor('status', {
        header: t('messaging.channel.status'),
        cell: (c) => <Badge tone={MESSAGE_STATUS_TONE[c.row.original.status]}>{t(`messaging.status.${c.row.original.status}`)}</Badge>,
      }),
      attempts: col.accessor('attempts', {
        header: t('messaging.message.attempts'),
        cell: (c) => (
          <span className={cn(c.getValue() > 1 && 'text-warn-fg')}>
            {c.getValue()} / {c.row.original.maxAttempts}
          </span>
        ),
        meta: { align: 'right', mono: true },
      }),
      next: col.accessor((m) => (m.nextAttemptAt ? Date.parse(m.nextAttemptAt) : Number.MAX_SAFE_INTEGER), {
        id: 'next',
        header: t('messaging.message.nextAttempt'),
        cell: (c) => <RelativeTime value={c.row.original.nextAttemptAt} />,
      }),
      duration: col.accessor((m) => m.durationMs ?? -1, {
        id: 'duration',
        header: t('messaging.message.duration'),
        cell: (c) => f.duration(c.row.original.durationMs),
        meta: { align: 'right', mono: true },
      }),
      error: col.accessor('error', {
        header: t('messaging.message.lastError'),
        enableSorting: false,
        cell: (c) => <span className="text-crit-fg">{c.getValue() ?? ''}</span>,
        meta: { truncate: true, width: '40%' },
      }),
      size: col.accessor('size', {
        header: t('messaging.message.size'),
        cell: (c) => <span className={cn(c.row.original.large && 'text-warn-fg')}>{f.bytes(c.getValue())}</span>,
        meta: { align: 'right', mono: true },
      }),
    };
    const list = (colKey.split(',') as MessageColumn[]).map((c) => all[c]);
    if (actions) {
      list.push(
        col.display({
          id: 'actions',
          header: '',
          cell: (c) => (
            <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
              {actions(c.row.original)}
            </div>
          ),
          meta: { align: 'right' },
        }),
      );
    }
    return list;
  }, [t, f, formatTime, colKey, actions]);

  return (
    <DataTable
      data={rows}
      columns={defs}
      getRowId={messageRowId}
      onRowClick={onOpen}
      activeRowId={activeId}
      rowTone={(m) => (m.status === 'dead_letter' ? 'crit' : m.status === 'retrying' ? 'warn' : undefined)}
      emptyMessage={emptyMessage}
      {...rest}
    />
  );
}

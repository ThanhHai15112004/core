import React, { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { cn } from '@core/lib/cn';
import { Badge } from '@core/ui/primitives';
import { DataTable } from '@core/ui/blocks';
import type { ChannelRow } from '../../types/messaging.types';
import { CHANNEL_STATUS_RANK, CHANNEL_STATUS_TONE } from '../../constants/messaging';
import { formatMsgRate } from '../../utils/messaging-format';

const col = createColumnHelper<ChannelRow>();

interface Props {
  rows: ChannelRow[];
  onOpen: (name: string) => void;
  activeId?: string | null;
  /** Bản gọn cho Tổng quan: bỏ cột lỗi, không sort. */
  compact?: boolean;
  emptyMessage: string;
  footer?: React.ReactNode;
  maxHeight?: number;
}

/** Bảng channel (topic): publish / consume, lag, lỗi, trạng thái — sort bằng header, mặc định nặng nhất lên trước. */
export function ChannelTable({ rows, onOpen, activeId, compact, emptyMessage, footer, maxHeight }: Props) {
  const { t } = useLocale();
  const f = useFormat();
  const columns = useMemo(
    () => [
      col.accessor('channel', {
        header: t('messaging.channel.name'),
        enableSorting: !compact,
        cell: (c) => (
          <div className="min-w-0">
            <div className="truncate font-mono text-xs text-fg">{c.getValue()}</div>
            {c.row.original.queue && <div className="truncate text-2xs text-faint">{t('messaging.channel.via', { queue: c.row.original.queue })}</div>}
          </div>
        ),
      }),
      col.accessor((r) => r.publishPerSec ?? -1, {
        id: 'publish',
        header: t('messaging.channel.publish'),
        enableSorting: !compact,
        cell: (c) => formatMsgRate(c.row.original.publishPerSec, f.locale),
        meta: { align: 'right', mono: true },
      }),
      col.accessor((r) => r.consumePerSec ?? -1, {
        id: 'consume',
        header: t('messaging.channel.consume'),
        enableSorting: !compact,
        cell: (c) => formatMsgRate(c.row.original.consumePerSec, f.locale),
        meta: { align: 'right', mono: true },
      }),
      col.accessor((r) => r.lag ?? -1, {
        id: 'lag',
        header: t('messaging.channel.lag'),
        enableSorting: !compact,
        cell: (c) => <span className={cn((c.row.original.lag ?? 0) > 0 && 'text-warn-fg')}>{f.compact(c.row.original.lag)}</span>,
        meta: { align: 'right', mono: true },
      }),
      ...(compact
        ? []
        : [
            col.accessor((r) => (r.failed ?? 0) + (r.deadLettered ?? 0), {
              id: 'errors',
              header: t('messaging.channel.errors'),
              cell: (c) => {
                const r = c.row.original;
                const bad = (r.failed ?? 0) + (r.deadLettered ?? 0) > 0;
                return (
                  <span className={cn(bad ? 'text-warn-fg' : 'text-faint')}>
                    {f.compact(r.failed)}
                    {r.failureRatePercent !== null && (r.failed ?? 0) > 0 && <span className="ml-1 text-2xs text-faint">{f.percent(r.failureRatePercent)}</span>}
                  </span>
                );
              },
              meta: { align: 'right' as const, mono: true },
            }),
          ]),
      col.accessor((r) => CHANNEL_STATUS_RANK[r.status], {
        id: 'status',
        header: t('messaging.channel.status'),
        enableSorting: !compact,
        cell: (c) => <Badge tone={CHANNEL_STATUS_TONE[c.row.original.status]}>{t(`messaging.channel.statusOf.${c.row.original.status}`)}</Badge>,
      }),
    ],
    [t, f, compact],
  );
  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.channel}
      onRowClick={(r) => onOpen(r.channel)}
      activeRowId={activeId}
      rowTone={(r) => CHANNEL_STATUS_TONE[r.status]}
      initialSorting={compact ? [] : [{ id: 'status', desc: true }]}
      emptyMessage={emptyMessage}
      footer={footer}
      maxHeight={maxHeight}
    />
  );
}

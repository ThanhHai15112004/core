import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { DataTable } from '@core/ui/blocks';
import type { EndpointRow } from '../../types/traffic.types';
import { ENDPOINT_TABLE_MAX_HEIGHT_PX, ENDPOINT_TONE } from '../../constants/traffic';
import { EndpointLabel, EndpointStatusBadge } from './TrafficBadges';
import { useTrafficFormat } from './useTrafficFormat';

const col = createColumnHelper<EndpointRow>();
/** Cột số: căn phải, mono, không xuống dòng (bảng cuộn ngang trên màn hẹp). */
const NUM = { align: 'right', mono: true, className: 'whitespace-nowrap' } as const;
/** Null (chưa có request) xếp cuối khi sort giảm dần. */
const nullLast = -1;

interface EndpointTableProps {
  rows: EndpointRow[];
  onOpen: (routeId: string) => void;
  /** Cột sort ban đầu (giảm dần). */
  sortColumn: string;
  emptyMessage?: string;
}

/** Hiệu năng theo endpoint — sort bằng header; trạng thái do backend suy ra (Ổn định / Chậm / Lỗi cao / Đang lỗi). */
export function EndpointTable({ rows, onOpen, sortColumn, emptyMessage }: EndpointTableProps) {
  const { t } = useLocale();
  const tf = useTrafficFormat();

  const columns = useMemo(
    () => [
      col.accessor('id', {
        header: t('tr.col.endpoint'),
        cell: (c) => <EndpointLabel method={c.row.original.method} route={c.row.original.route} internal={c.row.original.internal} />,
        meta: { width: '34%' },
      }),
      col.accessor((r) => r.stats.requestsPerSecond, { id: 'rps', header: t('tr.col.rps'), cell: (c) => tf.rps(c.getValue()), meta: NUM }),
      col.accessor((r) => r.stats.requests, { id: 'requests', header: t('tr.col.requests'), cell: (c) => tf.count(c.getValue()), meta: NUM }),
      col.accessor((r) => r.stats.avgLatencyMs ?? nullLast, {
        id: 'avg',
        header: t('tr.col.avg'),
        cell: (c) => tf.latency(c.row.original.stats.avgLatencyMs),
        meta: NUM,
      }),
      col.accessor((r) => r.stats.p50LatencyMs ?? nullLast, {
        id: 'p50',
        header: t('tr.col.p50'),
        cell: (c) => tf.latency(c.row.original.stats.p50LatencyMs),
        meta: NUM,
      }),
      col.accessor((r) => r.stats.p95LatencyMs ?? nullLast, {
        id: 'p95',
        header: t('tr.col.p95'),
        cell: (c) => <span className={c.row.original.status === 'slow' ? 'text-warn-fg' : undefined}>{tf.latency(c.row.original.stats.p95LatencyMs)}</span>,
        meta: NUM,
      }),
      col.accessor((r) => r.stats.p99LatencyMs ?? nullLast, {
        id: 'p99',
        header: t('tr.col.p99'),
        cell: (c) => tf.latency(c.row.original.stats.p99LatencyMs),
        meta: NUM,
      }),
      col.accessor((r) => r.stats.errorRatePercent, {
        id: 'serverRate',
        header: t('tr.col.errors5xx'),
        cell: (c) => <span className={c.row.original.stats.serverErrors > 0 ? 'text-crit-fg' : 'text-faint'}>{tf.rate(c.getValue())}</span>,
        meta: NUM,
      }),
      col.accessor((r) => r.stats.clientErrorRatePercent, {
        id: 'clientRate',
        header: t('tr.col.errors4xx'),
        cell: (c) => <span className={c.row.original.stats.clientErrors > 0 ? 'text-warn-fg' : 'text-faint'}>{tf.rate(c.getValue())}</span>,
        meta: NUM,
      }),
      col.accessor('status', { header: t('tr.col.status'), cell: (c) => <EndpointStatusBadge status={c.getValue()} reasons={c.row.original.reasons} /> }),
    ],
    [t, tf],
  );

  return (
    <div className="overflow-x-auto">
      <DataTable
        className="min-w-[900px]"
        data={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => onOpen(r.id)}
        rowTone={(r) => (ENDPOINT_TONE[r.status] === 'ok' ? undefined : ENDPOINT_TONE[r.status])}
        rowClassName={(r) => (r.stats.requests === 0 ? 'opacity-60' : undefined)}
        initialSorting={[{ id: sortColumn, desc: true }]}
        maxHeight={ENDPOINT_TABLE_MAX_HEIGHT_PX}
        emptyMessage={emptyMessage}
      />
    </div>
  );
}

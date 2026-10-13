import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { KeyRound, ShieldAlert } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { Badge } from '@core/ui/primitives';
import { DataTable } from '@core/ui/blocks';
import type { KeyFilter, NamespaceRow } from '../../types/cache.types';

const col = createColumnHelper<NamespaceRow>();

interface NamespaceTableProps {
  rows: NamespaceRow[];
  onOpen: (row: NamespaceRow) => void;
  /** Bấm số "không TTL" / "sắp hết hạn" → mở Keys đã lọc. */
  onBrowse?: (name: string, ttl: KeyFilter['ttl']) => void;
  activeName?: string | null;
  emptyMessage: string;
  /** Chỉ cột chính (Tổng quan). */
  compact?: boolean;
  maxHeight?: number;
}

/** Bảng namespace do backend gom theo prefix key: số key, dung lượng, TTL — sort theo header, bấm để xem chi tiết. */
export function NamespaceTable({ rows, onOpen, onBrowse, activeName, emptyMessage, compact, maxHeight }: NamespaceTableProps) {
  const { t } = useLocale();
  const f = useFormat();
  const columns = useMemo(() => {
    const count = (id: 'persistent' | 'expiringSoon', ttl: KeyFilter['ttl'], warn: boolean) =>
      col.accessor(id, {
        header: t(id === 'persistent' ? 'cache.ns.persistent' : 'cache.ns.expiringSoon'),
        cell: (c) => {
          const v = c.getValue();
          if (!v) return <span className="text-faint">0</span>;
          const text = <span className={warn ? 'text-warn-fg' : undefined}>{f.compact(v)}</span>;
          return onBrowse ? (
            <button type="button" className="hover:underline" onClick={(e) => (e.stopPropagation(), onBrowse(c.row.original.name, ttl))}>
              {text}
            </button>
          ) : (
            text
          );
        },
        meta: { align: 'right', mono: true, width: '110px' },
      });
    return [
      col.accessor('name', {
        header: t('cache.ns.name'),
        cell: (c) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-xs text-fg">{c.getValue()}</span>
            {c.row.original.session && (
              <Badge tone="warn" size="xs">
                <KeyRound />
                {t('cache.ns.session')}
              </Badge>
            )}
            {!c.row.original.session && c.row.original.sensitive && (
              <Badge size="xs">
                <ShieldAlert />
                {t('cache.ns.sensitive')}
              </Badge>
            )}
          </span>
        ),
        meta: { truncate: true },
      }),
      col.accessor('keys', { header: t('cache.ns.keys'), cell: (c) => f.compact(c.getValue()), meta: { align: 'right', mono: true, width: '90px' } }),
      col.accessor('bytes', { header: t('cache.ns.memory'), cell: (c) => f.bytes(c.getValue()), meta: { align: 'right', mono: true, width: '100px' } }),
      col.accessor((r) => (r.keys === 0 ? null : (r.avgTtlMs ?? Number.MAX_SAFE_INTEGER)), {
        id: 'avgTtl',
        header: t('cache.ns.avgTtl'),
        cell: (c) => (c.row.original.keys === 0 ? NO_VALUE : c.row.original.avgTtlMs === null ? t('cache.ttl.none') : f.duration(c.row.original.avgTtlMs)),
        sortUndefined: 'last',
        meta: { align: 'right', mono: true, width: '120px', className: 'whitespace-nowrap' },
      }),
      ...(compact ? [] : [count('persistent', 'persistent', false), count('expiringSoon', 'lt1m', true)]),
    ];
  }, [t, f, compact, onBrowse]);

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.name}
      onRowClick={onOpen}
      activeRowId={activeName ?? undefined}
      initialSorting={compact ? [] : [{ id: 'keys', desc: true }]}
      emptyMessage={emptyMessage}
      maxHeight={maxHeight}
    />
  );
}

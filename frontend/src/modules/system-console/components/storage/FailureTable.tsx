import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { FileText } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { Badge, Button, Hint } from '@core/ui/primitives';
import { DataTable, RelativeTime } from '@core/ui/blocks';
import type { StorageErrorItem } from '../../types/storage.types';

const col = createColumnHelper<StorageErrorItem & { id: string }>();

/** Bảng upload/download lỗi: thời điểm, object, kích thước, mã lỗi + thông điệp; mở log theo correlationId. */
export function FailureTable({ items, emptyMessage, navigate }: { items: StorageErrorItem[]; emptyMessage: string; navigate: (path: string) => void }) {
  const { t } = useLocale();
  const f = useFormat();
  const rows = useMemo(() => items.map((e, i) => ({ ...e, id: `${e.at}-${i}` })), [items]);
  const columns = useMemo(
    () => [
      col.accessor('at', { header: t('storage.errors.time'), cell: (c) => <RelativeTime value={c.getValue()} className="text-xs" />, meta: { width: '120px', className: 'whitespace-nowrap' } }),
      col.accessor('key', {
        header: t('storage.object.key'),
        cell: (c) => (
          <div className="min-w-0">
            <div className="truncate font-mono text-xs text-fg">{c.getValue()}</div>
            <div className="flex min-w-0 items-center gap-1.5 text-2xs text-muted">
              <Badge tone={c.row.original.kind === 'not_found' ? undefined : 'warn'} size="xs">
                {c.row.original.code ?? t(`storage.errors.kind.${c.row.original.kind}`)}
              </Badge>
              <span className="truncate">{c.row.original.message}</span>
            </div>
          </div>
        ),
        meta: { truncate: true },
      }),
      col.accessor('size', { header: t('storage.object.size'), cell: (c) => f.bytes(c.getValue()), meta: { align: 'right', mono: true, width: '90px' } }),
      col.display({
        id: 'logs',
        header: () => <span className="sr-only">{t('storage.errors.openLogs')}</span>,
        cell: (c) =>
          c.row.original.correlationId ? (
            <Hint content={t('storage.errors.openLogs')}>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={t('storage.errors.openLogs')}
                onClick={() => navigate(`logs/explorer?correlationId=${encodeURIComponent(c.row.original.correlationId!)}`)}
              >
                <FileText />
              </Button>
            </Hint>
          ) : null,
        meta: { align: 'right', width: '44px' },
      }),
    ],
    [t, f, navigate],
  );
  return <DataTable data={rows} columns={columns} getRowId={(r) => r.id} emptyMessage={emptyMessage} initialSorting={[{ id: 'at', desc: true }]} />;
}

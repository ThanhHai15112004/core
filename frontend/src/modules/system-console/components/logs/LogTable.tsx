import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { AlertTriangle, Braces } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { Badge, Hint } from '@core/ui/primitives';
import { DataTable, LevelBadge, type LogLevel as BadgeLevel } from '@core/ui/blocks';
import { NO_VALUE, shortId } from '@core/lib/format';
import type { LogRow } from '../../types/logs.types';
import { contextOf, logTime } from '../../utils/logs-format';

const col = createColumnHelper<LogRow>();
const CTX_ID_HEAD = 10;

interface LogTableProps {
  rows: LogRow[];
  onOpen: (id: string) => void;
  activeId?: string | null;
  /** Dòng mới đến (live) — tô nhẹ. */
  freshIds?: Set<string>;
  /** Danh sách dài → ảo hoá + cuộn trong bảng. */
  maxHeight?: number;
  emptyMessage?: string;
  loadMore?: { hasMore: boolean; loading?: boolean; onLoadMore: () => void };
  footer?: React.ReactNode;
}

/** Bảng log: Thời gian · Level · Nguồn · Ngữ cảnh · Nội dung (2 dòng). Metadata / stack xem trong drawer. */
export function LogTable({ rows, onOpen, activeId, freshIds, maxHeight, emptyMessage, loadMore, footer }: LogTableProps) {
  const { t } = useLocale();
  const columns = useMemo(
    () => [
      col.accessor('at', {
        header: t('logs.col.time'),
        cell: (c) => <time dateTime={c.getValue()}>{logTime(c.getValue())}</time>,
        meta: { mono: true, width: '108px' },
        enableSorting: false,
      }),
      col.accessor('level', {
        header: t('logs.col.level'),
        cell: (c) => <LevelBadge level={c.getValue() as BadgeLevel} />,
        meta: { width: '76px' },
        enableSorting: false,
      }),
      col.accessor('runtime', {
        header: t('logs.col.source'),
        cell: (c) => c.getValue() ?? NO_VALUE,
        meta: { width: '96px', truncate: true },
        enableSorting: false,
      }),
      col.display({
        id: 'context',
        header: t('logs.col.context'),
        cell: (c) => {
          const ctx = contextOf(c.row.original);
          if (!ctx) return <span className="text-faint">{NO_VALUE}</span>;
          return (
            <Hint content={`${t(`logs.ctx.${ctx.kind}`)} ${ctx.id}`}>
              <span className="font-mono text-xs text-fg-2">
                {/^[a-z]{2,8}_/i.test(ctx.id) ? '' : t(`logs.ctxShort.${ctx.kind}`)}
                {shortId(ctx.id, CTX_ID_HEAD, 0)}
              </span>
            </Hint>
          );
        },
        meta: { width: '150px' },
      }),
      col.accessor('message', {
        header: t('logs.col.message'),
        cell: (c) => {
          const r = c.row.original;
          return (
            <div className="flex min-w-0 items-start gap-2">
              <div className="line-clamp-2 min-w-0 flex-1 break-words text-fg" title={r.message}>
                {r.module && <span className="mr-1.5 font-mono text-xs text-muted">[{r.module}]</span>}
                {r.message}
              </div>
              {r.errorType && (
                <Badge tone="crit" size="xs" className="max-w-40 truncate">
                  {r.errorType}
                </Badge>
              )}
              {r.hasStack && <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-crit" aria-label={t('logs.detail.stack')} />}
              {r.hasMetadata && <Braces className="mt-0.5 size-3.5 shrink-0 text-faint" aria-label={t('logs.detail.metadata')} />}
            </div>
          );
        },
        enableSorting: false,
      }),
    ],
    [t],
  );

  return (
    <DataTable
      data={rows}
      columns={columns}
      getRowId={(r) => r.id}
      onRowClick={(r) => onOpen(r.id)}
      activeRowId={activeId}
      rowTone={(r) => (r.level === 'fatal' || r.level === 'error' ? 'crit' : r.level === 'warn' ? 'warn' : undefined)}
      rowClassName={(r) => (freshIds?.has(r.id) ? 'bg-info-bg' : undefined)}
      maxHeight={maxHeight}
      virtual={maxHeight !== undefined}
      emptyMessage={emptyMessage}
      loadMore={loadMore}
      footer={footer}
    />
  );
}

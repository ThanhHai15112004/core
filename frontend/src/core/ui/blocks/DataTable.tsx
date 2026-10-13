import React, { useMemo, useRef, useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type RowData,
  type SortingState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useLocale } from '../../i18n/index';
import { TONE_CLASS, type Tone } from '../../theme/tone';
import { TABLE_OVERSCAN_ROWS, TABLE_ROW_HEIGHT_PX } from '../../constants/ui.constants';
import { Button } from '../primitives/button';
import { PanelState } from './PanelState';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: 'left' | 'right' | 'center';
    /** Độ rộng CSS (vd. '120px', '30%'). */
    width?: string;
    /** Cắt chữ 1 dòng (kèm title đầy đủ khi giá trị là chuỗi). */
    truncate?: boolean;
    /** Font mono + tabular-nums (số, id, thời gian). */
    mono?: boolean;
    className?: string;
  }
}

export type { ColumnDef, SortingState } from '@tanstack/react-table';

export interface DataTableProps<T> {
  data: T[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<T, any>[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Hàng đang mở (drawer) — tô nền. */
  activeRowId?: string | null;
  /** Viền trái theo tông của hàng (vd. hàng lỗi). */
  rowTone?: (row: T) => Tone | undefined;
  /** Class thêm cho hàng (vd. tô nhẹ dòng mới đến). */
  rowClassName?: (row: T) => string | undefined;
  initialSorting?: SortingState;
  /** Sort phía server: truyền state + handler, bảng không tự sort. */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  /** Lọc nhanh toàn bảng (phía client). */
  globalFilter?: string;
  emptyMessage?: React.ReactNode;
  /** Chiều cao tối đa → cuộn trong bảng, header dính. */
  maxHeight?: number | string;
  /** Ảo hoá hàng (danh sách dài) — cần `maxHeight`. */
  virtual?: boolean;
  /** "Tải thêm" theo cursor. */
  loadMore?: { hasMore: boolean; loading?: boolean; onLoadMore: () => void };
  footer?: React.ReactNode;
  className?: string;
}

const ALIGN = { left: 'text-left', right: 'text-right', center: 'text-center' } as const;

/** Bảng chuẩn: sort bằng header, cột căn/cắt theo meta, click hàng, ảo hoá, tải thêm. */
export function DataTable<T>({
  data,
  columns,
  getRowId,
  onRowClick,
  activeRowId,
  rowTone,
  rowClassName,
  initialSorting = [],
  sorting: controlledSorting,
  onSortingChange,
  globalFilter,
  emptyMessage,
  maxHeight,
  virtual,
  loadMore,
  footer,
  className,
}: DataTableProps<T>) {
  const { t } = useLocale();
  const [localSorting, setLocalSorting] = useState<SortingState>(initialSorting);
  const manual = controlledSorting !== undefined;
  const table = useReactTable({
    data,
    columns,
    getRowId,
    state: { sorting: manual ? controlledSorting : localSorting, globalFilter },
    onSortingChange: manual ? onSortingChange : setLocalSorting,
    manualSorting: manual,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    enableSortingRemoval: false,
  });

  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => TABLE_ROW_HEIGHT_PX,
    overscan: TABLE_OVERSCAN_ROWS,
    enabled: Boolean(virtual),
  });
  const virtualRows = virtual ? virtualizer.getVirtualItems() : null;
  const padTop = virtualRows && virtualRows.length ? virtualRows[0].start : 0;
  const padBottom = virtualRows && virtualRows.length ? virtualizer.getTotalSize() - virtualRows[virtualRows.length - 1].end : 0;
  const visible = useMemo(
    () => (virtualRows ? virtualRows.map((v) => ({ row: rows[v.index], index: v.index })) : rows.map((row, index) => ({ row, index }))),
    [virtualRows, rows],
  );
  const colCount = table.getVisibleLeafColumns().length;

  return (
    <div className={cn('min-w-0', className)}>
      <div ref={scrollRef} className="overflow-auto" style={maxHeight !== undefined ? { maxHeight } : undefined}>
        <table className="w-full border-collapse text-sm">
          <thead className={cn(maxHeight !== undefined && 'sticky top-0 z-10')}>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  const label = header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext());
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                      style={meta?.width ? { width: meta.width } : undefined}
                      className={cn(
                        'h-8 whitespace-nowrap border-b border-border bg-panel-2 px-3 text-xs font-medium text-muted',
                        ALIGN[meta?.align ?? 'left'],
                      )}
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn('inline-flex items-center gap-1 hover:text-fg', meta?.align === 'right' && 'flex-row-reverse')}
                          title={sorted === 'asc' ? t('ui.table.sortDesc') : t('ui.table.sortAsc')}
                        >
                          {label}
                          {sorted === 'asc' ? <ArrowUp className="size-3" /> : sorted === 'desc' ? <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}
                        </button>
                      ) : (
                        label
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {padTop > 0 && (
              <tr aria-hidden="true">
                <td colSpan={colCount} style={{ height: padTop }} />
              </tr>
            )}
            {visible.map(({ row, index }) => {
              const tone = rowTone?.(row.original);
              const active = activeRowId !== undefined && activeRowId === row.id;
              return (
                <tr
                  key={row.id}
                  ref={virtual ? virtualizer.measureElement : undefined}
                  data-index={index}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(
                    'border-b border-border last:border-b-0',
                    onRowClick && 'cursor-pointer hover:bg-panel-2',
                    active && 'bg-primary-subtle hover:bg-primary-subtle',
                    rowClassName?.(row.original),
                  )}
                  style={{ height: TABLE_ROW_HEIGHT_PX }}
                >
                  {row.getVisibleCells().map((cell, ci) => {
                    const meta = cell.column.columnDef.meta;
                    const raw = cell.getValue();
                    return (
                      <td
                        key={cell.id}
                        title={meta?.truncate && typeof raw === 'string' ? raw : undefined}
                        className={cn(
                          'px-3 py-1.5 align-middle text-fg-2',
                          ALIGN[meta?.align ?? 'left'],
                          meta?.mono && 'font-mono text-xs tabular-nums',
                          meta?.truncate && 'max-w-0 truncate',
                          ci === 0 && tone && tone !== 'unknown' && cn('border-l-2', TONE_CLASS[tone].border),
                          meta?.className,
                        )}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {padBottom > 0 && (
              <tr aria-hidden="true">
                <td colSpan={colCount} style={{ height: padBottom }} />
              </tr>
            )}
          </tbody>
        </table>
        {rows.length === 0 && <PanelState status="empty" compact message={data.length > 0 ? t('ui.table.noMatch') : emptyMessage} />}
      </div>
      {(loadMore?.hasMore || footer) && (
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted">
          <div>{footer}</div>
          {loadMore?.hasMore && (
            <Button size="xs" variant="secondary" onClick={loadMore.onLoadMore} disabled={loadMore.loading}>
              {t('ui.action.loadMore')}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

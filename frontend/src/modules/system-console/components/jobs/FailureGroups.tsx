import { useMemo } from 'react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { Badge } from '@core/ui/primitives';
import { DataTable, RelativeTime, UsageBar } from '@core/ui/blocks';
import type { FailureGroup } from '../../types/jobs.types';

const col = createColumnHelper<FailureGroup>();

/** Nhãn khả năng retry của một lỗi / nhóm lỗi. */
export function RetryableBadge({ value }: { value: boolean | null }) {
  const { t } = useLocale();
  if (value === false) return <Badge tone="warn">{t('jobs.retryable.no')}</Badge>;
  return <Badge tone={value ? 'ok' : undefined}>{t(value ? 'jobs.retryable.yes' : 'jobs.retryable.unknown')}</Badge>;
}

/** Nhóm lỗi: gộp lỗi cùng loại — bấm → Explorer lọc đúng loại lỗi. `detailed` = thêm loại job + lần cuối. */
export function FailureGroups({ groups, onOpen, detailed, emptyMessage }: { groups: FailureGroup[]; onOpen: (g: FailureGroup) => void; detailed?: boolean; emptyMessage?: string }) {
  const { t } = useLocale();
  const f = useFormat();
  const max = Math.max(1, ...groups.map((g) => g.count));
  const columns = useMemo(() => {
    const list: ColumnDef<FailureGroup, unknown>[] = [
      col.accessor('errorType', {
        header: t('jobs.failures.col.error'),
        cell: (c) => (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate font-mono text-xs text-crit-fg">{c.getValue()}</span>
            {c.row.original.dependency && <span className="shrink-0 text-xs text-faint">{t(`jobs.dependency.${c.row.original.dependency}`)}</span>}
          </span>
        ),
        meta: { truncate: true },
      }) as ColumnDef<FailureGroup, unknown>,
      col.accessor('count', {
        header: t('jobs.failures.col.count'),
        cell: (c) => (
          <span className="flex items-center justify-end gap-2">
            <UsageBar percent={(c.getValue() / max) * 100} tone="crit" showValue={false} className="w-16" />
            <span className="w-10 text-right">{f.compact(c.getValue())}</span>
          </span>
        ),
        meta: { align: 'right', mono: true, width: '140px' },
      }) as ColumnDef<FailureGroup, unknown>,
    ];
    if (detailed) list.push(col.accessor((g) => g.types.join(', '), { id: 'types', header: t('jobs.failures.col.types'), meta: { truncate: true } }) as ColumnDef<FailureGroup, unknown>);
    list.push(
      col.accessor((g) => (g.retryable === null ? 1 : g.retryable ? 2 : 0), {
        id: 'retry',
        header: t('jobs.failures.col.retry'),
        cell: (c) => <RetryableBadge value={c.row.original.retryable} />,
        meta: { width: '130px' },
      }) as ColumnDef<FailureGroup, unknown>,
    );
    if (detailed)
      list.push(
        col.accessor((g) => (g.lastAt ? Date.parse(g.lastAt) : null), {
          id: 'last',
          header: t('jobs.failures.col.last'),
          cell: (c) => <RelativeTime value={c.row.original.lastAt} />,
          meta: { width: '120px' },
        }) as ColumnDef<FailureGroup, unknown>,
      );
    return list;
  }, [t, f, max, detailed]);

  return (
    <DataTable
      data={groups}
      columns={columns}
      getRowId={(g) => g.errorType}
      onRowClick={onOpen}
      initialSorting={[{ id: 'count', desc: true }]}
      emptyMessage={emptyMessage ?? t('jobs.failures.noGroups')}
    />
  );
}

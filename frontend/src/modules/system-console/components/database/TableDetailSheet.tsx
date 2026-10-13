import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE, UNIT } from '@core/lib/format';
import { Badge } from '@core/ui/primitives';
import { DataTable, DetailSection, DetailSheet, KeyValueGrid, QueryView } from '@core/ui/blocks';
import type { DbTableDetail } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { dbKeys } from '../../sections/database/database-keys';

type Index = DbTableDetail['indexes'][number];
type Column = DbTableDetail['columns'][number];
const idxCol = createColumnHelper<Index>();
const colCol = createColumnHelper<Column>();

/** Chi tiết bảng: kích thước, đọc / ghi, index và số lần dùng (0 lần chỉ là dữ kiện), danh sách cột. */
export function TableDetailSheet({ name, onClose }: { name: string | null; onClose: () => void }) {
  const query = useLiveQuery(dbKeys.table(name ?? ''), () => databaseApi.table(name!), { tier: 'slow', enabled: Boolean(name), keepPrevious: false });
  return (
    <DetailSheet open={Boolean(name)} onOpenChange={(o) => !o && onClose()} width="lg" title={<span className="font-mono">{name}</span>} subtitle={query.data?.engine ?? undefined}>
      <QueryView query={query}>{(d) => <TableBody d={d} />}</QueryView>
    </DetailSheet>
  );
}

function TableBody({ d }: { d: DbTableDetail }) {
  const { t } = useLocale();
  const f = useFormat();
  const indexColumns = useMemo(
    () => [
      idxCol.accessor('name', {
        header: t('db.table.index'),
        cell: (c) => (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs text-fg">{c.getValue()}</span>
            {c.row.original.primary ? (
              <Badge size="xs">{t('db.table.primary')}</Badge>
            ) : c.row.original.unique ? (
              <Badge size="xs">{t('db.table.unique')}</Badge>
            ) : null}
          </span>
        ),
      }),
      idxCol.accessor((i) => i.columns.join(', '), { id: 'columns', header: t('db.table.columns'), meta: { mono: true, truncate: true } }),
      idxCol.accessor('scans', {
        header: t('db.table.scans'),
        cell: (c) => {
          const i = c.row.original;
          return (
            <span className="flex flex-col items-end">
              <span>{i.scans === null ? NO_VALUE : f.compact(i.scans)}</span>
              {i.scans === 0 && !i.primary && <span className="font-sans text-2xs text-warn-fg">{t('db.table.unusedShort')}</span>}
            </span>
          );
        },
        meta: { align: 'right', mono: true, width: '110px' },
      }),
    ],
    [t, f],
  );
  const columnColumns = useMemo(
    () => [
      colCol.accessor('name', { header: t('db.table.column'), meta: { mono: true } }),
      colCol.accessor('type', { header: t('db.table.type'), meta: { mono: true } }),
      colCol.accessor('nullable', {
        header: t('db.table.nullable'),
        cell: (c) => (c.getValue() ? t('db.config.yes') : t('db.config.no')),
        meta: { width: '90px' },
      }),
    ],
    [t],
  );
  const growth = f.delta(d.growthPercent, 1, UNIT.percent);
  return (
    <>
      <DetailSection title={t('db.table.size')}>
        <KeyValueGrid
          columns={4}
          items={[
            { label: t('db.table.rows'), value: f.compact(d.rows), mono: true, hint: t('db.table.rowsNote') },
            { label: t('db.table.total'), value: f.bytes(d.totalBytes), mono: true },
            { label: t('db.table.data'), value: f.bytes(d.dataBytes), mono: true },
            { label: t('db.table.indexes'), value: f.bytes(d.indexBytes), mono: true },
            { label: t('db.table.growth'), value: growth, mono: true },
            { label: t('db.table.readsPerSec'), value: d.readsPerSec === null || d.readsPerSec === undefined ? null : f.rate(d.readsPerSec), mono: true },
            { label: t('db.table.writesPerSec'), value: d.writesPerSec === null || d.writesPerSec === undefined ? null : f.rate(d.writesPerSec), mono: true },
          ]}
        />
      </DetailSection>
      <DetailSection title={`${t('db.table.indexList')} · ${d.indexes.length}`} hint={t('db.table.scansNote')}>
        <div className="overflow-hidden rounded-md border border-border">
          <DataTable data={d.indexes} columns={indexColumns} getRowId={(i) => i.name} emptyMessage={t('db.table.noIndexes')} />
        </div>
      </DetailSection>
      <DetailSection title={`${t('db.table.columnList')} · ${d.columns.length}`}>
        <div className="overflow-hidden rounded-md border border-border">
          <DataTable data={d.columns} columns={columnColumns} getRowId={(c) => c.name} />
        </div>
      </DetailSection>
    </>
  );
}

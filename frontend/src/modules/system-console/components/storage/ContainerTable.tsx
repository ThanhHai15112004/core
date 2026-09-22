import React, { useState } from 'react';
import type { ContainerRow } from '../../types/storage.types';
import { formatBytes, formatCompact } from '../../utils/database-format';
import { formatGrowth } from '../../utils/storage-format';
import { useLocale } from '../../../../core/i18n/index';

const SORTS = ['size', 'objects', 'growth', 'errors', 'traffic'] as const;
type Sort = (typeof SORTS)[number];
const value = (c: ContainerRow, s: Sort) =>
  s === 'size'
    ? c.bytes
    : s === 'objects'
      ? c.objects
      : s === 'growth'
        ? (c.growth24hBytes ?? -Infinity)
        : s === 'errors'
          ? c.errors
          : c.uploadBytes + c.downloadBytes;

/** Bảng container (bucket prefix / thư mục gốc) — sort theo size, object, tăng trưởng, lỗi, traffic. */
export const ContainerTable: React.FC<{ rows: ContainerRow[]; onOpen: (name: string) => void; sortable?: boolean; emptyText: string }> = ({
  rows,
  onOpen,
  sortable = true,
  emptyText,
}) => {
  const { t, locale } = useLocale();
  const [sort, setSort] = useState<Sort>('size');
  if (rows.length === 0) return <p className="ov-empty-line">{emptyText}</p>;
  const list = sortable ? [...rows].sort((a, b) => value(b, sort) - value(a, sort)) : rows;
  return (
    <>
      {sortable && (
        <div className="ov-segmented cache-sort" role="tablist" aria-label={t('cache.ns.sort')}>
          {SORTS.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={sort === s} className={sort === s ? 'is-active' : ''} onClick={() => setSort(s)}>
              {t(`storage.container.sortBy.${s}`)}
            </button>
          ))}
        </div>
      )}
      <div className="scp-table-wrap">
        <table className="scp-table cache-ns-table">
          <thead>
            <tr>
              <th>{t('storage.container.name')}</th>
              <th>{t('storage.container.objects')}</th>
              <th>{t('storage.container.size')}</th>
              <th>{t('storage.container.growth')}</th>
              <th>{t('storage.container.traffic')}</th>
              <th>{t('storage.container.errors')}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.name} className="is-clickable" onClick={() => onOpen(c.name)}>
                <td>
                  <code>{c.name === '(root)' ? t('storage.container.root') : `${c.name}/`}</code>
                </td>
                <td>{formatCompact(c.objects, locale)}</td>
                <td>{formatBytes(c.bytes)}</td>
                <td>{formatGrowth(c.growth24hBytes)}</td>
                <td>
                  ↑ {formatBytes(c.uploadBytes)} · ↓ {formatBytes(c.downloadBytes)}
                </td>
                <td className={c.errors > 0 ? 'is-warn' : ''}>{c.errors}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

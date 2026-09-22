import React, { useState } from 'react';
import { KeyRound, ShieldAlert } from 'lucide-react';
import type { NamespaceRow } from '../../types/cache.types';
import { formatBytes, formatCompact } from '../../utils/database-format';
import { formatPercent, formatTtl, hitRateTone } from '../../utils/cache-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

const SORTS = ['keys', 'memory', 'hitRate', 'ttl'] as const;
export type NamespaceSort = (typeof SORTS)[number];
const sortValue = (n: NamespaceRow, s: NamespaceSort) =>
  s === 'keys' ? n.keys : s === 'memory' ? n.bytes : s === 'hitRate' ? (n.hitRatePercent ?? 101) : (n.avgTtlMs ?? Number.MAX_SAFE_INTEGER);

/** Bảng namespace (key, dung lượng, hit rate, TTL trung bình) — sort được, bấm để xem chi tiết. */
export const NamespaceTable: React.FC<{
  rows: NamespaceRow[];
  warnPercent: number;
  onOpen: (name: string) => void;
  sortable?: boolean;
  emptyText: string;
}> = ({ rows, warnPercent, onOpen, sortable = true, emptyText }) => {
  const { t, locale } = useLocale();
  const [sort, setSort] = useState<NamespaceSort>('keys');
  if (rows.length === 0) return <p className="ov-empty-line">{emptyText}</p>;
  // Hit rate thấp đứng trước khi sort theo hit rate; các cột còn lại lớn đứng trước.
  const list = sortable
    ? [...rows].sort((a, b) => (sort === 'hitRate' || sort === 'ttl' ? sortValue(a, sort) - sortValue(b, sort) : sortValue(b, sort) - sortValue(a, sort)))
    : rows;
  return (
    <>
      {sortable && (
        <div className="ov-segmented cache-sort" role="tablist" aria-label={t('cache.ns.sort')}>
          {SORTS.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={sort === s} className={sort === s ? 'is-active' : ''} onClick={() => setSort(s)}>
              {t(`cache.ns.sortBy.${s}`)}
            </button>
          ))}
        </div>
      )}
      <div className="scp-table-wrap">
        <table className="scp-table cache-ns-table">
          <thead>
            <tr>
              <th>{t('cache.ns.name')}</th>
              <th>{t('cache.ns.keys')}</th>
              <th>{t('cache.ns.memory')}</th>
              <th>{t('cache.ns.hitRate')}</th>
              <th>{t('cache.ns.avgTtl')}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((n) => (
              <tr key={n.name} className="is-clickable" onClick={() => onOpen(n.name)}>
                <td>
                  <code>{n.name}</code>
                  {n.session && (
                    <span className="pf-chip ov-tone-warn cache-chip">
                      <KeyRound size={11} /> {t('cache.ns.session')}
                    </span>
                  )}
                  {!n.session && n.sensitive && (
                    <span className="pf-chip ov-tone-unknown cache-chip">
                      <ShieldAlert size={11} /> {t('cache.ns.sensitive')}
                    </span>
                  )}
                </td>
                <td>{formatCompact(n.keys, locale)}</td>
                <td>{formatBytes(n.bytes)}</td>
                <td>
                  <span className={`cache-rate ov-tone-${hitRateTone(n.hitRatePercent, warnPercent)}`}>{formatPercent(n.hitRatePercent)}</span>
                  {n.hits + n.misses > 0 && <small className="pf-row-note">{t('cache.ns.reads', { count: formatCompact(n.hits + n.misses, locale) })}</small>}
                </td>
                <td>{n.keys === 0 ? NO_VALUE : n.avgTtlMs === null ? t('cache.ttl.none') : formatTtl(n.avgTtlMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

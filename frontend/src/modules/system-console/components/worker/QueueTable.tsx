import React, { useState } from 'react';
import { Search } from 'lucide-react';
import type { QueueRow } from '../../types/worker.types';
import { QUEUE_STATUS_RANK, QUEUE_STATUS_TONE } from '../../constants/worker';
import { formatCompact } from '../../utils/database-format';
import { formatAge } from '../../utils/messaging-format';
import { formatJobRate, formatMs, formatSignedRate } from '../../utils/worker-format';
import { useLocale } from '../../../../core/i18n/index';

const SORTS = ['status', 'waiting', 'failures', 'throughput', 'processing'] as const;
type Sort = (typeof SORTS)[number];
const value = (q: QueueRow, s: Sort) =>
  s === 'status'
    ? -QUEUE_STATUS_RANK[q.status]
    : s === 'waiting'
      ? q.waiting
      : s === 'failures'
        ? q.failed * 1000 + (q.failureRatePercent ?? 0)
        : s === 'throughput'
          ? (q.processingPerMin ?? -1)
          : (q.p95Ms ?? -1);

/** Bảng queue: chờ, đang chạy, hẹn giờ, lỗi, tốc độ xử lý, trạng thái — sort + tìm theo tên. */
export const QueueTable: React.FC<{ rows: QueueRow[]; onOpen: (name: string) => void; sortable?: boolean }> = ({ rows, onOpen, sortable = true }) => {
  const { t, locale } = useLocale();
  const [sort, setSort] = useState<Sort>('status');
  const [search, setSearch] = useState('');
  if (rows.length === 0) return <p className="ov-empty-line">{t('wq.queue.empty')}</p>;
  const n = (v: number) => formatCompact(v, locale);
  const list = sortable
    ? rows.filter((q) => q.name.toLowerCase().includes(search.trim().toLowerCase())).sort((a, b) => value(b, sort) - value(a, sort))
    : rows;
  return (
    <>
      {sortable && (
        <div className="wq-table-tools">
          <label className="wq-search">
            <Search size={13} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('wq.queue.search')} aria-label={t('wq.queue.search')} />
          </label>
          <div className="ov-segmented cache-sort" role="tablist" aria-label={t('cache.ns.sort')}>
            {SORTS.map((s) => (
              <button key={s} type="button" role="tab" aria-selected={sort === s} className={sort === s ? 'is-active' : ''} onClick={() => setSort(s)}>
                {t(`wq.queue.sortBy.${s}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="scp-table-wrap">
        <table className="scp-table cache-ns-table">
          <thead>
            <tr>
              <th>{t('wq.queue.name')}</th>
              <th>{t('wq.queue.waiting')}</th>
              <th>{t('wq.queue.active')}</th>
              <th>{t('wq.queue.delayed')}</th>
              <th>{t('wq.queue.failed')}</th>
              <th>{t('wq.queue.rate')}</th>
              <th>P95</th>
              <th>{t('wq.queue.status')}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((q) => (
              <tr key={q.name} className="is-clickable" onClick={() => onOpen(q.name)}>
                <td>
                  <code>{q.name}</code>
                  <small className="pf-row-note">
                    {q.workers === null ? '' : t('wq.queue.workersN', { count: q.workers })}
                    {q.concurrency > 0 && ` · ${t('wq.queue.concurrencyN', { count: q.concurrency })}`}
                  </small>
                </td>
                <td className={q.status === 'backlog' || q.status === 'no_consumer' ? 'is-warn' : ''}>
                  {n(q.waiting)}
                  {q.oldestWaitingSec !== null && <small className="pf-row-note">{t('wq.queue.oldestShort', { age: formatAge(q.oldestWaitingSec) })}</small>}
                </td>
                <td>{n(q.active)}</td>
                <td>{n(q.delayed)}</td>
                <td className={q.failed > 0 ? 'is-warn' : ''}>
                  {n(q.failed)}
                  {q.failureRatePercent !== null && q.failureRatePercent > 0 && <small className="pf-row-note">{q.failureRatePercent}%</small>}
                </td>
                <td>
                  {formatJobRate(q.processingPerMin)}
                  {q.growthPerMin !== null && q.growthPerMin > 0.5 && q.waiting > 0 && (
                    <small className="pf-row-note is-warn">{t('wq.queue.growing', { rate: formatSignedRate(q.growthPerMin) })}</small>
                  )}
                </td>
                <td>{formatMs(q.p95Ms)}</td>
                <td>
                  <span className={`pf-chip ov-tone-${QUEUE_STATUS_TONE[q.status]}`}>{t(`wq.queue.statusOf.${q.status}`)}</span>
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr>
                <td colSpan={8} className="ov-empty-line">
                  {t('wq.queue.noMatch')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
};

import React, { useState } from 'react';
import type { ChannelRow } from '../../types/messaging.types';
import { CHANNEL_STATUS_TONE } from '../../constants/messaging';
import { formatCompact } from '../../utils/database-format';
import { formatUnit } from '../../utils/performance-format';
import { formatMsgRate } from '../../utils/messaging-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

const SORTS = ['status', 'throughput', 'lag', 'errors', 'failureRate'] as const;
type Sort = (typeof SORTS)[number];
const STATUS_RANK = { no_consumer: 0, high_failure: 1, lagging: 2, healthy: 3, idle: 4 } as const;
const value = (c: ChannelRow, s: Sort) =>
  s === 'status'
    ? -STATUS_RANK[c.status]
    : s === 'throughput'
      ? c.published + c.consumed
      : s === 'lag'
        ? (c.lag ?? -1)
        : s === 'errors'
          ? c.failed + c.deadLettered
          : (c.failureRatePercent ?? -1);

/** Bảng channel (topic): publish/consume, lag, lỗi, trạng thái — sort theo throughput, lag, lỗi, tỷ lệ lỗi. */
export const ChannelTable: React.FC<{ rows: ChannelRow[]; onOpen: (name: string) => void; sortable?: boolean; emptyText: string }> = ({
  rows,
  onOpen,
  sortable = true,
  emptyText,
}) => {
  const { t, locale } = useLocale();
  const [sort, setSort] = useState<Sort>('status');
  if (rows.length === 0) return <p className="ov-empty-line">{emptyText}</p>;
  const list = sortable ? [...rows].sort((a, b) => value(b, sort) - value(a, sort)) : rows;
  return (
    <>
      {sortable && (
        <div className="ov-segmented cache-sort" role="tablist" aria-label={t('cache.ns.sort')}>
          {SORTS.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={sort === s} className={sort === s ? 'is-active' : ''} onClick={() => setSort(s)}>
              {t(`messaging.channel.sortBy.${s}`)}
            </button>
          ))}
        </div>
      )}
      <div className="scp-table-wrap">
        <table className="scp-table cache-ns-table">
          <thead>
            <tr>
              <th>{t('messaging.channel.name')}</th>
              <th>{t('messaging.channel.publish')}</th>
              <th>{t('messaging.channel.consume')}</th>
              <th>{t('messaging.channel.lag')}</th>
              <th>{t('messaging.channel.errors')}</th>
              <th>{t('messaging.channel.status')}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.channel} className="is-clickable" onClick={() => onOpen(c.channel)}>
                <td>
                  <code>{c.channel}</code>
                  {c.queue && <small className="pf-row-note">{t('messaging.channel.via', { queue: c.queue })}</small>}
                </td>
                <td>{formatMsgRate(c.publishPerSec)}</td>
                <td>{formatMsgRate(c.consumePerSec)}</td>
                <td className={(c.lag ?? 0) > 0 ? 'is-warn' : ''}>
                  {c.lag === null ? NO_VALUE : formatCompact(c.lag, locale)}
                </td>
                <td className={c.failed + c.deadLettered > 0 ? 'is-warn' : ''}>
                  {c.failed}
                  {c.failureRatePercent !== null && c.failed > 0 && <small className="pf-row-note">{formatUnit(c.failureRatePercent, '%')}</small>}
                </td>
                <td>
                  <span className={`pf-chip ov-tone-${CHANNEL_STATUS_TONE[c.status]}`}>{t(`messaging.channel.statusOf.${c.status}`)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

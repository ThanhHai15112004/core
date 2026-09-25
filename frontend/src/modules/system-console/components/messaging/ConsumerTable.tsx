import React from 'react';
import type { ConsumerRow } from '../../types/messaging.types';
import { CONSUMER_STATUS_TONE } from '../../constants/messaging';
import { formatCompact } from '../../utils/database-format';
import { formatUnit } from '../../utils/performance-format';
import { formatMsgRate } from '../../utils/messaging-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** Bảng consumer: tốc độ, lag của queue, P95 xử lý, tỷ lệ lỗi, instance, trạng thái. */
export const ConsumerTable: React.FC<{ rows: ConsumerRow[]; onOpen: (name: string) => void; emptyText: string }> = ({ rows, onOpen, emptyText }) => {
  const { t, locale } = useLocale();
  if (rows.length === 0) return <p className="ov-empty-line">{emptyText}</p>;
  return (
    <div className="scp-table-wrap">
      <table className="scp-table cache-ns-table">
        <thead>
          <tr>
            <th>{t('messaging.consumer.name')}</th>
            <th>{t('messaging.consumer.rate')}</th>
            <th>{t('messaging.consumer.lag')}</th>
            <th>P95</th>
            <th>{t('messaging.consumer.failures')}</th>
            <th>{t('messaging.consumer.instances')}</th>
            <th>{t('messaging.channel.status')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={`${c.consumer}-${c.queue}`} className="is-clickable" onClick={() => onOpen(c.consumer)}>
              <td>
                <code>{c.consumer}</code>
                <small className="pf-row-note">
                  {c.queue}
                  {c.runtime && ` · ${t(`rt.name.${c.runtime}`)}`}
                </small>
              </td>
              <td>{formatMsgRate(c.perSec)}</td>
              <td className={(c.lag ?? 0) > 0 ? 'is-warn' : ''}>{c.lag === null ? NO_VALUE : formatCompact(c.lag, locale)}</td>
              <td>{formatUnit(c.p95Ms, 'ms')}</td>
              <td className={c.failed > 0 ? 'is-warn' : ''}>
                {c.failed}
                {c.failureRatePercent !== null && c.failed > 0 && <small className="pf-row-note">{formatUnit(c.failureRatePercent, '%')}</small>}
              </td>
              <td>
                {c.instances.length}
                <small className="pf-row-note">{t('messaging.consumer.concurrency', { n: c.instances.reduce((s, i) => s + i.concurrency, 0) })}</small>
              </td>
              <td>
                <span className={`pf-chip ov-tone-${CONSUMER_STATUS_TONE[c.status]}`}>{t(`messaging.consumer.statusOf.${c.status}`)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

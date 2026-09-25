import React from 'react';
import type { QueueRow } from '../../types/messaging.types';
import { formatCompact } from '../../utils/database-format';
import { formatAge } from '../../utils/messaging-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** Độ sâu queue trên broker: chờ (ready), đang xử lý (unacked), hẹn giờ/retry, dead letter, worker. */
export const QueueDepthTable: React.FC<{ rows: QueueRow[] }> = ({ rows }) => {
  const { t, locale } = useLocale();
  const n = (v: number) => formatCompact(v, locale);
  return (
    <div className="scp-table-wrap">
      <table className="scp-table">
        <thead>
          <tr>
            <th>{t('messaging.queue.name')}</th>
            <th>{t('messaging.queue.waiting')}</th>
            <th>{t('messaging.queue.active')}</th>
            <th>{t('messaging.queue.delayed')}</th>
            <th>{t('messaging.queue.failed')}</th>
            <th>{t('messaging.queue.oldest')}</th>
            <th>{t('messaging.queue.consumers')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((q) => {
            const noConsumer = q.waiting > 0 && q.workers === 0;
            return (
              <tr key={q.name}>
                <td>
                  <code>{q.name}</code>
                  {q.paused && <small className="pf-row-note">{t('messaging.queue.paused')}</small>}
                </td>
                <td className={q.waiting > 0 ? 'is-warn' : ''}>{n(q.waiting)}</td>
                <td>{n(q.active)}</td>
                <td>{n(q.delayed)}</td>
                <td className={q.failed > 0 ? 'is-warn' : ''}>{n(q.failed)}</td>
                <td>{q.oldestWaitingSec === null ? NO_VALUE : formatAge(q.oldestWaitingSec)}</td>
                <td>
                  {noConsumer ? (
                    <span className="pf-chip ov-tone-crit">{t('messaging.queue.noConsumer')}</span>
                  ) : (
                    <>
                      {q.workers ?? NO_VALUE}
                      {q.consumers.length > 0 && <small className="pf-row-note">{q.consumers.join(', ')}</small>}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

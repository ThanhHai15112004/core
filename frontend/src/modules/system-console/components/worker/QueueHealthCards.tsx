import React from 'react';
import type { QueueRow } from '../../types/worker.types';
import { QUEUE_STATUS_TONE } from '../../constants/worker';
import { formatCompact } from '../../utils/database-format';
import { useLocale } from '../../../../core/i18n/index';

/** Queue Health: mỗi queue một thẻ (trạng thái + chờ / chạy / lỗi), bấm → Queue Detail. */
export const QueueHealthCards: React.FC<{ rows: QueueRow[]; onOpen: (name: string) => void }> = ({ rows, onOpen }) => {
  const { t, locale } = useLocale();
  if (rows.length === 0) return <p className="ov-empty-line">{t('wq.queue.empty')}</p>;
  const n = (v: number) => formatCompact(v, locale);
  return (
    <div className="wq-queue-cards">
      {rows.map((q) => (
        <button key={q.name} type="button" className={`wq-queue-card ov-tone-${QUEUE_STATUS_TONE[q.status]}`} onClick={() => onOpen(q.name)}>
          <span className="wq-queue-card-head">
            <code>{q.name}</code>
            <span className={`pf-chip ov-tone-${QUEUE_STATUS_TONE[q.status]}`}>{t(`wq.queue.statusOf.${q.status}`)}</span>
          </span>
          <dl>
            <div>
              <dt>{t('wq.queue.waiting')}</dt>
              <dd className={q.status === 'backlog' || q.status === 'no_consumer' ? 'is-warn' : ''}>{n(q.waiting)}</dd>
            </div>
            <div>
              <dt>{t('wq.queue.active')}</dt>
              <dd>{n(q.active)}</dd>
            </div>
            <div>
              <dt>{t('wq.queue.failed')}</dt>
              <dd className={q.failed > 0 ? 'is-warn' : ''}>{n(q.failed)}</dd>
            </div>
          </dl>
        </button>
      ))}
    </div>
  );
};

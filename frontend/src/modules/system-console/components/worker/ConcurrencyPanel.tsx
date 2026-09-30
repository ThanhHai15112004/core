import React from 'react';
import type { Concurrency, WorkerRow } from '../../types/worker.types';
import { instanceLabel } from '../../utils/worker-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/**
 * Concurrency: cấu hình / đang dùng / còn trống + mức dùng theo từng worker (active ÷ concurrency cấu hình).
 * Chỉ báo "gần giới hạn" — Console không tự đề xuất số instance cần scale.
 */
export const ConcurrencyPanel: React.FC<{ concurrency: Concurrency | null; workers: WorkerRow[]; warnPercent?: number }> = ({ concurrency, workers, warnPercent = 90 }) => {
  const { t } = useLocale();
  if (!concurrency) return <p className="ov-empty-line">{t('wq.concurrency.none')}</p>;
  const near = (concurrency.utilizationPercent ?? 0) >= warnPercent;
  return (
    <>
      <dl className="db-stat-grid db-stat-compact">
        <div>
          <dt>{t('wq.concurrency.configured')}</dt>
          <dd>{concurrency.configured}</dd>
        </div>
        <div>
          <dt>{t('wq.concurrency.active')}</dt>
          <dd>{concurrency.active}</dd>
        </div>
        <div>
          <dt>{t('wq.concurrency.available')}</dt>
          <dd>{concurrency.available}</dd>
        </div>
        <div>
          <dt>{t('wq.concurrency.utilization')}</dt>
          <dd className={near ? 'is-warn' : ''}>{concurrency.utilizationPercent === null ? NO_VALUE : `${concurrency.utilizationPercent}%`}</dd>
        </div>
      </dl>
      {near && <p className="msg-status-line ov-tone-warn">{t('wq.concurrency.near')}</p>}
      {workers.length > 0 && (
        <ul className="cache-bars">
          {workers.map((w) => {
            const pct = w.concurrency > 0 ? Math.min(100, (w.active / w.concurrency) * 100) : 0;
            return (
              <li key={w.id} className={pct >= warnPercent ? 'is-warn' : ''}>
                <span className="cache-bar-label">{instanceLabel(w.id)}</span>
                <span className="cache-bar-track">
                  <span style={{ width: `${pct}%` }} />
                </span>
                <span className="cache-bar-value">
                  {w.active} / {w.concurrency}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
};

import React from 'react';
import { AlertOctagon } from 'lucide-react';
import type { QueueDetailTab, WorkerRange } from '../../types/worker.types';
import { workerApi } from '../../services/worker.api';
import { usePolling } from '../../hooks/usePolling';
import { WorkerTable } from '../../components/worker/WorkerTable';
import { QueueTable } from '../../components/worker/QueueTable';
import { ConcurrencyPanel } from '../../components/worker/ConcurrencyPanel';
import { SectionState } from '../../components/database/SectionState';
import { formatCompact } from '../../utils/database-format';
import { useLocale } from '../../../../core/i18n/index';

interface ViewProps {
  range: WorkerRange;
  paused: boolean;
  reloadKey: number;
  product: string;
  now: number;
}

/** Worker instance (tự báo, có TTL) + concurrency + ổn định (restart/crash, lấy từ Runtime Monitor). */
export const WorkerWorkersView: React.FC<ViewProps & { openWorker: (id: string) => void; openQueue: (name: string, sub?: QueueDetailTab) => void }> = ({
  paused,
  reloadKey,
  openWorker,
  openQueue,
}) => {
  const { t, formatTime } = useLocale();
  const { data, error } = usePolling(() => workerApi.workers(), `workers:${reloadKey}`, 15_000, paused);
  return (
    <>
      {data && data.unconsumed.length > 0 && (
        <section className="pf-status db-health ov-tone-crit" role="alert">
          <AlertOctagon size={20} className="pf-status-icon" />
          <div className="db-health-body">
            <strong>{t('wq.worker.unconsumedTitle')}</strong>
            <ul className="db-health-reasons">
              {data.unconsumed.map((q) => (
                <li key={q}>
                  <button type="button" className="ov-link" onClick={() => openQueue(q)}>
                    <code>{q}</code>
                  </button>
                </li>
              ))}
            </ul>
            <p className="db-health-last">{t('wq.worker.unconsumedHint')}</p>
          </div>
        </section>
      )}
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('wq.worker.title')}</h3>
          {data && (
            <span className="ov-section-hint">
              {data.brokerWorkers === null ? t('wq.worker.hint', { count: data.workers.length }) : t('wq.worker.hintBroker', { count: data.workers.length, broker: data.brokerWorkers })}
            </span>
          )}
        </header>
        {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
        {data && <WorkerTable rows={data.workers} onOpen={openWorker} emptyText={t('wq.worker.empty')} />}
        <p className="pf-chart-note">{t('wq.worker.note')}</p>
      </section>
      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('wq.concurrency.title')}</h3>
          </header>
          {data && <ConcurrencyPanel concurrency={data.concurrency} workers={data.workers} />}
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('wq.stability.title')}</h3>
          </header>
          {data && (
            <>
              <dl className="db-stat-grid db-stat-compact">
                <div>
                  <dt>{t('wq.stability.restarts')}</dt>
                  <dd className={data.stability.restartsToday > 0 ? 'is-warn' : ''}>{data.stability.restartsToday}</dd>
                </div>
                <div>
                  <dt>{t('wq.stability.crashes')}</dt>
                  <dd className={data.stability.crashesToday > 0 ? 'is-warn' : ''}>{data.stability.crashesToday}</dd>
                </div>
              </dl>
              {data.stability.history.length === 0 ? (
                <p className="cache-ok-line">{t('wq.stability.none')}</p>
              ) : (
                <ul className="cache-key-list">
                  {data.stability.history.map((h) => (
                    <li key={h.at}>
                      <span>
                        {new Date(h.at).toLocaleDateString()} {formatTime(Date.parse(h.at))}
                      </span>
                      <span className={h.reasonCode === 'crash' || h.reasonCode === 'unexpected' ? 'is-warn' : ''}>{h.reason}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="pf-chart-note">{t('wq.stability.note')}</p>
            </>
          )}
        </section>
      </div>
    </>
  );
};

/** Bảng queue: sort theo chờ / lỗi / throughput / thời gian xử lý, tìm theo tên; bấm → Queue Detail. */
export const WorkerQueuesView: React.FC<ViewProps & { openQueue: (name: string, sub?: QueueDetailTab) => void }> = ({
  range,
  paused,
  reloadKey,
  product,
  openQueue,
}) => {
  const { t, locale } = useLocale();
  const { data, error } = usePolling(() => workerApi.queues(range), `queues:${range}:${reloadKey}`, 15_000, paused);
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('wq.queue.title')}</h3>
        {data && (
          <span className="ov-section-hint">
            {t('wq.queue.thresholds', { warn: formatCompact(data.thresholds.backlogWarn, locale), crit: formatCompact(data.thresholds.backlogCrit, locale) })}
          </span>
        )}
      </header>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      <SectionState section={data?.queues} driver={product} scope="wq">
        {(rows) => <QueueTable rows={rows} onOpen={(q) => openQueue(q)} />}
      </SectionState>
      <p className="pf-chart-note">{t('wq.queue.note', { range: t(`tr.range.${range}`) })}</p>
    </section>
  );
};

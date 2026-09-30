import React, { useState } from 'react';
import type { WorkerMetric, WorkerRange } from '../../types/worker.types';
import { workerApi } from '../../services/worker.api';
import { usePolling } from '../../hooks/usePolling';
import { WORKER_METRICS } from '../../constants/worker';
import { LineChart } from '../common/LineChart';
import { toWorkerChart } from '../../utils/worker-format';
import { useLocale } from '../../../../core/i18n/index';

/**
 * Queue Performance: throughput (nhận vào vs hoàn tất), job chờ, thời gian xử lý, lỗi, retry — toàn bộ hoặc một
 * queue. `queue` cố định (Queue Detail) thì không hiện bộ chọn queue.
 */
export const WorkerChart: React.FC<{
  range: WorkerRange;
  paused: boolean;
  queues?: string[];
  queue?: string;
  initial?: WorkerMetric;
  title?: string;
}> = ({ range, paused, queues = [], queue: fixed, initial = 'throughput', title }) => {
  const { t, formatTime } = useLocale();
  const [metric, setMetric] = useState<WorkerMetric>(initial);
  const [picked, setPicked] = useState('');
  const queue = fixed ?? (picked || undefined);
  const { data } = usePolling(() => workerApi.metrics(range, metric, queue), `${range}:${metric}:${queue ?? ''}`, undefined, paused);
  const { series, unit } = toWorkerChart(data?.series ?? []);
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{title ?? t('wq.chart.title')}</h3>
        <div className="wq-chart-controls">
          {!fixed && queues.length > 1 && (
            <label className="wq-select">
              <span>{t('wq.chart.queue')}</span>
              <select value={picked} onChange={(e) => setPicked(e.target.value)}>
                <option value="">{t('wq.chart.allQueues')}</option>
                {queues.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.metric')}>
            {WORKER_METRICS.map((m) => (
              <button key={m} type="button" role="tab" aria-selected={metric === m} className={metric === m ? 'is-active' : ''} onClick={() => setMetric(m)}>
                {t(`wq.chart.metric.${m}`)}
              </button>
            ))}
          </div>
        </div>
      </header>
      <LineChart
        series={series}
        unit={unit}
        formatTime={(ts) => formatTime(ts, range === '15m')}
        emptyText={t('wq.chart.empty')}
        ariaLabel={title ?? t('wq.chart.title')}
      />
      <p className="pf-chart-note">{t(`wq.chart.note.${metric}`)}</p>
    </section>
  );
};

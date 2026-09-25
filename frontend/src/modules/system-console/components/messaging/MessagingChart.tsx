import React, { useState } from 'react';
import type { MessagingMetric, MessagingRange } from '../../types/messaging.types';
import { messagingApi } from '../../services/messaging.api';
import { usePolling } from '../../hooks/usePolling';
import { MESSAGING_METRICS } from '../../constants/messaging';
import { LineChart } from '../common/LineChart';
import { toMessagingChart } from '../../utils/messaging-format';
import { useLocale } from '../../../../core/i18n/index';

/** Biểu đồ messaging: throughput (publish vs consume), lag, lỗi/retry, thời gian xử lý, kích thước. */
export const MessagingChart: React.FC<{ range: MessagingRange; paused: boolean; initial?: MessagingMetric }> = ({ range, paused, initial = 'throughput' }) => {
  const { t, formatTime } = useLocale();
  const [metric, setMetric] = useState<MessagingMetric>(initial);
  const { data } = usePolling(() => messagingApi.metrics(range, metric), `${range}:${metric}`, undefined, paused);
  const { series, unit } = toMessagingChart(data?.series ?? []);
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('messaging.chart.title')}</h3>
        <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.metric')}>
          {MESSAGING_METRICS.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={metric === m} className={metric === m ? 'is-active' : ''} onClick={() => setMetric(m)}>
              {t(`messaging.chart.metric.${m}`)}
            </button>
          ))}
        </div>
      </header>
      <LineChart
        series={series}
        unit={unit}
        formatTime={(ts) => formatTime(ts, range === '15m')}
        emptyText={t('messaging.chart.empty')}
        ariaLabel={t('messaging.chart.title')}
      />
      <p className="pf-chart-note">{t(metric === 'lag' ? 'messaging.chart.noteLag' : 'messaging.chart.note')}</p>
    </section>
  );
};

import React, { useState } from 'react';
import type { StorageMetric, StorageRange } from '../../types/storage.types';
import { storageApi } from '../../services/storage.api';
import { usePolling } from '../../hooks/usePolling';
import { STORAGE_METRICS } from '../../constants/storage';
import { LineChart } from '../common/LineChart';
import { toStorageChart } from '../../utils/storage-format';
import { useLocale } from '../../../../core/i18n/index';

/** Biểu đồ storage: upload, download, latency, thao tác, lỗi (range theo trang). */
export const StorageChart: React.FC<{ range: StorageRange; paused: boolean; initial?: StorageMetric }> = ({ range, paused, initial = 'upload' }) => {
  const { t, formatTime } = useLocale();
  const [metric, setMetric] = useState<StorageMetric>(initial);
  const { data } = usePolling(() => storageApi.metrics(range, metric), `${range}:${metric}`, undefined, paused);
  const { series, unit } = toStorageChart(data?.series ?? []);
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('storage.chart.title')}</h3>
        <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.metric')}>
          {STORAGE_METRICS.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={metric === m} className={metric === m ? 'is-active' : ''} onClick={() => setMetric(m)}>
              {t(`storage.chart.metric.${m}`)}
            </button>
          ))}
        </div>
      </header>
      <LineChart
        series={series}
        unit={unit}
        formatTime={(ts) => formatTime(ts, range === '15m')}
        emptyText={t('storage.chart.empty')}
        ariaLabel={t('storage.chart.title')}
      />
      <p className="pf-chart-note">{t('storage.chart.note')}</p>
    </section>
  );
};

import React, { useState } from 'react';
import type { CacheMetric, CacheRange } from '../../types/cache.types';
import { cacheApi } from '../../services/cache.api';
import { usePolling } from '../../hooks/usePolling';
import { CACHE_METRICS } from '../../constants/cache';
import { LineChart } from '../common/LineChart';
import { toChartSeries } from '../../utils/cache-format';
import { useLocale } from '../../../../core/i18n/index';

/** Biểu đồ cache: hit rate, hit/miss, thao tác, bộ nhớ, số key, eviction (range theo trang). */
export const CacheChart: React.FC<{ range: CacheRange; paused: boolean; initial?: CacheMetric }> = ({ range, paused, initial = 'hitRate' }) => {
  const { t, formatTime } = useLocale();
  const [metric, setMetric] = useState<CacheMetric>(initial);
  const { data } = usePolling(() => cacheApi.metrics(range, metric), `${range}:${metric}`, undefined, paused);
  const { series, unit } = toChartSeries(data?.series ?? []);
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('cache.chart.title')}</h3>
        <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.metric')}>
          {CACHE_METRICS.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={metric === m} className={metric === m ? 'is-active' : ''} onClick={() => setMetric(m)}>
              {t(`cache.chart.metric.${m}`)}
            </button>
          ))}
        </div>
      </header>
      <LineChart
        series={series}
        unit={unit}
        formatTime={(ts) => formatTime(ts, range === '15m')}
        emptyText={t('cache.chart.empty')}
        ariaLabel={t('cache.chart.title')}
      />
      <p className="pf-chart-note">{t(data?.serverWide || metric === 'memory' ? 'cache.chart.noteServer' : 'cache.chart.note')}</p>
    </section>
  );
};

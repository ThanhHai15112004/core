import React, { useState } from 'react';
import type { DbMetric, DbRange } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { usePolling } from '../../hooks/usePolling';
import { DB_METRICS, DB_SERIES_COLORS } from '../../constants/database';
import { FALLBACK_COLORS } from '../../constants/performance';
import { LineChart, type ChartSeries } from '../common/LineChart';
import { useLocale } from '../../../../core/i18n/index';

/** Biểu đồ hiệu năng database (từ instrumentation của app): query, latency, kết nối, lỗi, transaction. */
export const DbChart: React.FC<{ range: DbRange; paused: boolean }> = ({ range, paused }) => {
  const { t, formatTime } = useLocale();
  const [metric, setMetric] = useState<DbMetric>('queries');
  const { data } = usePolling(() => databaseApi.metrics(range, metric), `${range}:${metric}`, undefined, paused);
  const series: ChartSeries[] = (data?.series ?? []).map((s, i) => ({
    id: s.id,
    label: s.label,
    unit: s.unit,
    color: DB_SERIES_COLORS[s.id] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]!,
    points: s.points,
  }));
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('db.chart.title')}</h3>
        <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.metric')}>
          {DB_METRICS.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={metric === m} className={metric === m ? 'is-active' : ''} onClick={() => setMetric(m)}>
              {t(`db.chart.metric.${m}`)}
            </button>
          ))}
        </div>
      </header>
      <LineChart
        series={series}
        unit={data?.unit ?? ''}
        formatTime={(ts) => formatTime(ts, range === '15m')}
        emptyText={t('db.chart.empty')}
        ariaLabel={t('db.chart.title')}
      />
      <p className="pf-chart-note">{t('db.chart.note')}</p>
    </section>
  );
};

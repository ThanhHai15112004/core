import React, { useState } from 'react';
import type { TimeseriesMetric, TrafficFilters } from '../../types/traffic.types';
import { trafficApi } from '../../services/traffic.api';
import { usePolling } from '../../hooks/usePolling';
import { CHART_METRICS, SERIES_COLORS } from '../../constants/traffic';
import { LineChart, type ChartSeries } from '../common/LineChart';
import { formatMs, formatPct, formatRps } from '../../utils/traffic-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

const UNIT_LABEL = { rps: 'req/s', ms: 'ms', percent: '%' } as const;

interface TrafficChartProps {
  filters: TrafficFilters;
  paused: boolean;
  /** Giới hạn trong một endpoint (trang chi tiết endpoint). */
  routeId?: string;
  metrics?: TimeseriesMetric[];
  title?: string;
}

/** Biểu đồ chính: Requests / Latency (P50-P95-P99) / Errors / Status codes theo thời gian. */
export const TrafficChart: React.FC<TrafficChartProps> = ({ filters, paused, routeId, metrics = CHART_METRICS, title }) => {
  const { t, formatTime } = useLocale();
  const [metric, setMetric] = useState<TimeseriesMetric>(metrics[0] ?? 'requests');
  const key = `${metric}:${routeId ?? ''}:${JSON.stringify(filters)}`;
  const { data } = usePolling(() => trafficApi.timeseries(filters, metric, routeId), key, undefined, paused);

  const series: ChartSeries[] = (data?.series ?? []).map((s) => ({
    id: s.id,
    label: t(`tr.series.${s.id}`),
    color: SERIES_COLORS[s.id] ?? 'var(--scp-series-1)',
    points: s.points,
  }));
  const fmt = (v: number | null) =>
    v === null
      ? NO_VALUE
      : data?.unit === 'ms' ? formatMs(v) : data?.unit === 'percent' ? formatPct(v) : `${formatRps(v)} req/s`;
  const showSeconds = filters.range === '5m' || filters.range === '15m';

  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{title ?? t('tr.chart.title')}</h3>
        {metrics.length > 1 && (
          <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.metric')}>
            {metrics.map((m) => (
              <button key={m} type="button" role="tab" aria-selected={metric === m} className={metric === m ? 'is-active' : ''} onClick={() => setMetric(m)}>
                {t(`tr.chart.metric.${m}`)}
              </button>
            ))}
          </div>
        )}
      </header>

      <LineChart
        series={series}
        unit={data ? UNIT_LABEL[data.unit] : ''}
        formatTime={(ts) => formatTime(ts, showSeconds)}
        emptyText={t('tr.chart.empty')}
        ariaLabel={title ?? t('tr.chart.title')}
      />

      {data && (
        <dl className="tr-chart-stats">
          <div>
            <dt>{t('tr.chart.current')}</dt>
            <dd>{fmt(data.current)}</dd>
          </div>
          <div>
            <dt>{t(`tr.chart.average.${data.metric}`)}</dt>
            <dd>{fmt(data.average)}</dd>
          </div>
          <div>
            <dt>{t('tr.chart.peak')}</dt>
            <dd>
              {fmt(data.peak)}
              {data.peakAt !== null && <small> · {formatTime(data.peakAt, false)}</small>}
            </dd>
          </div>
          <div>
            <dt>{t('tr.chart.step')}</dt>
            <dd>{t('tr.chart.stepValue', { seconds: data.stepSec })}</dd>
          </div>
        </dl>
      )}
    </section>
  );
};

import React from 'react';
import type { PerformanceDataPoint, PerformanceMetricKey, PerformanceTimeRange } from '../../types/console.types';
import type { PerformanceStats } from '../../hooks/useMetricHistory';
import { LineChart } from '../common/LineChart';
import { useLocale } from '../../../../core/i18n/index';

interface PerformanceChartProps {
  activeMetric: PerformanceMetricKey;
  onMetricChange: (metric: PerformanceMetricKey) => void;
  timeRange: PerformanceTimeRange;
  onTimeRangeChange: (range: PerformanceTimeRange) => void;
  series: PerformanceDataPoint[];
  stats: PerformanceStats;
}

const METRICS: PerformanceMetricKey[] = ['requests', 'latency', 'errors', 'cpu', 'memory'];
const RANGES: PerformanceTimeRange[] = ['15m', '1h', '6h', '24h'];
const UNITS: Record<PerformanceMetricKey, string> = { requests: 'req/s', latency: 'ms', errors: '%', cpu: '%', memory: 'GB' };

/** Vùng ④: một biểu đồ lớn, đổi metric/khoảng thời gian. */
export const PerformanceChart: React.FC<PerformanceChartProps> = ({
  activeMetric,
  onMetricChange,
  timeRange,
  onTimeRangeChange,
  series,
  stats,
}) => {
  const { t, formatTime } = useLocale();

  return (
    <section className="ov-card ov-section ov-chart" aria-labelledby="ov-chart-title">
      <header className="ov-section-head">
        <h3 id="ov-chart-title">{t('ov.chart.title')}</h3>
        <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.range')}>
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              role="tab"
              aria-selected={timeRange === range}
              className={timeRange === range ? 'is-active' : ''}
              onClick={() => onTimeRangeChange(range)}
            >
              {t(`chart.range${range}`)}
            </button>
          ))}
        </div>
      </header>

      <div className="ov-segmented ov-chart-metrics" role="tablist" aria-label={t('ov.chart.metric')}>
        {METRICS.map((metric) => (
          <button
            key={metric}
            type="button"
            role="tab"
            aria-selected={activeMetric === metric}
            className={activeMetric === metric ? 'is-active' : ''}
            onClick={() => onMetricChange(metric)}
          >
            {t(`chart.${metric}`)}
          </button>
        ))}
      </div>

      <dl className="ov-chart-stats">
        <div>
          <dt>{t('chart.current')}</dt>
          <dd>{stats.current}</dd>
        </div>
        <div>
          <dt>{t('chart.average')}</dt>
          <dd>{stats.average}</dd>
        </div>
        <div>
          <dt>{t('chart.peak')}</dt>
          <dd>{stats.peak}</dd>
        </div>
      </dl>

      <LineChart
        series={[{ id: activeMetric, label: t(`chart.${activeMetric}`), color: 'var(--scp-chart-line)', points: series }]}
        unit={UNITS[activeMetric]}
        formatTime={(ts) => formatTime(ts, false)}
        emptyText={t('chart.noSamples')}
        ariaLabel={t('ov.chart.title')}
      />
    </section>
  );
};

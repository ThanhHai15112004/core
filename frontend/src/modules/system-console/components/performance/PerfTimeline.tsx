import React from 'react';
import { Download } from 'lucide-react';
import type { PerfFilters, PerfMetric } from '../../types/performance.types';
import { performanceApi } from '../../services/performance.api';
import { usePolling } from '../../hooks/usePolling';
import {
  BASELINE_COLOR,
  BASELINE_MODES,
  COMPARE_COLOR,
  FALLBACK_COLORS,
  MARKER_COLORS,
  PERF_METRICS,
  PERF_SERIES_COLORS,
  PRIMARY_METRICS,
} from '../../constants/performance';
import { LineChart, type ChartMarker, type ChartSeries } from '../common/LineChart';
import { formatUnit } from '../../utils/performance-format';
import { downloadCsv } from '../../utils/traffic-format';
import { useLocale } from '../../../../core/i18n/index';

interface PerfTimelineProps {
  filters: PerfFilters;
  paused: boolean;
  intervalMs: number;
  setFilters: (patch: Partial<Record<keyof PerfFilters, string | undefined>>) => void;
}

const EXTRA_METRICS = PERF_METRICS.filter((m) => !PRIMARY_METRICS.includes(m));

/**
 * Biểu đồ chính: một chỉ số theo thời gian, overlay chỉ số khác trên trục phải để tìm tương quan,
 * baseline (kỳ trước / hôm qua / tuần trước) nét đứt và mốc sự kiện (restart, bắt đầu nghẽn).
 */
export const PerfTimeline: React.FC<PerfTimelineProps> = ({ filters, paused, intervalMs, setFilters }) => {
  const { t, formatTime } = useLocale();
  const key = JSON.stringify(filters);
  const { data } = usePolling(() => performanceApi.timeseries(filters), key, intervalMs, paused);
  const showSeconds = filters.range === '5m' || filters.range === '15m';

  let fallback = 0;
  const series: ChartSeries[] = (data?.series ?? []).map((s) => ({
    id: s.id,
    label: s.label,
    unit: s.unit,
    axis: s.axis,
    dashed: s.kind === 'baseline',
    color:
      s.kind === 'compare'
        ? COMPARE_COLOR
        : s.kind === 'baseline'
          ? BASELINE_COLOR
          : (PERF_SERIES_COLORS[s.id] ?? FALLBACK_COLORS[fallback++ % FALLBACK_COLORS.length]!),
    points: s.points,
  }));
  const markers: ChartMarker[] = (data?.markers ?? []).map((m) => ({
    t: m.t,
    label: m.label,
    color: MARKER_COLORS[m.severity] ?? 'var(--scp-info)',
  }));
  const compareSeries = data?.series.find((s) => s.kind === 'compare');
  const unit = data?.unit ?? '';

  const exportCsv = () => {
    if (!data) return;
    const times = [...new Set(data.series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);
    const byId = data.series.map((s) => new Map(s.points.map((p) => [p.t, p.value])));
    downloadCsv(
      `performance-${filters.metric}-${filters.range}.csv`,
      ['time', ...data.series.map((s) => `${s.label} (${s.unit})`)],
      times.map((ts) => [new Date(ts).toISOString(), ...byId.map((m) => m.get(ts) ?? null)]),
    );
  };

  const selectMetric = (metric: PerfMetric) =>
    setFilters({ metric: metric === 'latency' ? undefined : metric, compare: filters.compare === metric ? undefined : filters.compare });

  return (
    <section className="ov-card ov-section pf-timeline">
      <header className="ov-section-head">
        <h3>{t('perf.timeline.title')}</h3>
        <div className="pf-metric-picker">
          <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.metric')}>
            {PRIMARY_METRICS.map((m) => (
              <button key={m} type="button" role="tab" aria-selected={filters.metric === m} className={filters.metric === m ? 'is-active' : ''} onClick={() => selectMetric(m)}>
                {t(`perf.metric.${m}`)}
              </button>
            ))}
          </div>
          <label className="tr-field">
          <select
            aria-label={t('perf.timeline.moreMetrics')}
            value={EXTRA_METRICS.includes(filters.metric) ? filters.metric : ''}
            onChange={(e) => e.target.value && selectMetric(e.target.value as PerfMetric)}
          >
            <option value="">{t('perf.timeline.moreMetrics')}</option>
            {EXTRA_METRICS.map((m) => (
              <option key={m} value={m}>
                {t(`perf.metric.${m}`)}
              </option>
            ))}
          </select>
          </label>
        </div>
      </header>

      <div className="pf-timeline-tools">
        <label className="tr-field">
          <span>{t('perf.timeline.compare')}</span>
          <select value={filters.compare ?? ''} onChange={(e) => setFilters({ compare: e.target.value || undefined })}>
            <option value="">{t('perf.timeline.none')}</option>
            {PERF_METRICS.filter((m) => m !== filters.metric).map((m) => (
              <option key={m} value={m}>
                {t(`perf.metric.${m}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="tr-field">
          <span>{t('perf.timeline.baseline')}</span>
          <select value={filters.baseline ?? ''} onChange={(e) => setFilters({ baseline: e.target.value || undefined })}>
            <option value="">{t('perf.timeline.none')}</option>
            {BASELINE_MODES.map((b) => (
              <option key={b} value={b}>
                {t(`perf.baseline.${b}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={exportCsv} disabled={!data}>
          <Download size={13} /> {t('perf.timeline.export')}
        </button>
      </div>

      <LineChart
        series={series}
        unit={unit}
        markers={markers}
        formatTime={(ts) => formatTime(ts, showSeconds)}
        emptyText={t('perf.timeline.empty')}
        ariaLabel={t('perf.timeline.title')}
        height={260}
      />

      {data && (
        <>
          <dl className="tr-chart-stats">
            <div>
              <dt>{t('perf.timeline.current')}</dt>
              <dd>{formatUnit(data.stats.current, unit)}</dd>
            </div>
            <div>
              <dt>{t('perf.timeline.avg')}</dt>
              <dd>{formatUnit(data.stats.avg, unit)}</dd>
            </div>
            <div>
              <dt>{t('perf.timeline.peak')}</dt>
              <dd>
                {formatUnit(data.stats.peak, unit)}
                {data.stats.peakAt && <small> · {formatTime(Date.parse(data.stats.peakAt), showSeconds)}</small>}
              </dd>
            </div>
            <div>
              <dt>{t('perf.timeline.resolution')}</dt>
              <dd>{data.resolutionSec ? t('perf.timeline.resolutionValue', { seconds: data.resolutionSec }) : '--'}</dd>
            </div>
          </dl>
          <p className="pf-chart-note">
            {compareSeries && t('perf.timeline.rightAxis', { label: compareSeries.label, unit: compareSeries.unit })}
            {data.baselineUnavailable && ` ${t('perf.timeline.baselineUnavailable')}`}
            {markers.length > 0 && ` ${t('perf.timeline.markersHint', { count: markers.length })}`}
          </p>
        </>
      )}
    </section>
  );
};

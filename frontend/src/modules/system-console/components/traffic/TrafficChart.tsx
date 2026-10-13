import React, { useState } from 'react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { CHART_GROUP, TIME_RANGE_MS } from '@core/constants/ui.constants';
import { MetricChart, type MetricStat, type TimeSeries } from '@core/ui/charts';
import type { Timeseries, TimeseriesMetric, TrafficFilters } from '../../types/traffic.types';
import { trafficApi } from '../../services/traffic.api';
import { LATENCY_SERIES_ORDER, SERIES_COLOR } from '../../constants/traffic';
import { trafficKeys } from '../../sections/traffic/traffic-keys';
import { useTrafficFormat } from './useTrafficFormat';

interface TrafficChartProps {
  title: string;
  filters: TrafficFilters;
  /** Từ 2 chỉ số → có nút chuyển. */
  metrics: TimeseriesMetric[];
  /** Giới hạn trong một endpoint. */
  routeId?: string;
  /** Ngưỡng P95 cảnh báo (ms) — vẽ đường ngưỡng trên biểu đồ latency. */
  latencyThresholdMs?: number;
  height?: 'sm' | 'md';
  actions?: React.ReactNode;
  className?: string;
}

const sortLatency = (series: Timeseries['series']) => [...series].sort((a, b) => LATENCY_SERIES_ORDER.indexOf(a.id) - LATENCY_SERIES_ORDER.indexOf(b.id));

/** Biểu đồ traffic theo thời gian: requests / latency P50-P95-P99 / tỷ lệ 5xx / status 2xx–5xx (cột chồng). */
export function TrafficChart({ title, filters, metrics, routeId, latencyThresholdMs, height = 'md', actions, className }: TrafficChartProps) {
  const { t, formatTime } = useLocale();
  const tf = useTrafficFormat();
  const [metric, setMetric] = useState<TimeseriesMetric>(metrics[0] ?? 'requests');
  const q = useLiveQuery(trafficKeys.timeseries(filters, metric, routeId), () => trafficApi.timeseries(filters, metric, routeId));
  const d = q.data?.metric === metric ? q.data : undefined;

  const fmt = (v: number | null) => (d?.unit === 'ms' ? tf.latency(v) : d?.unit === 'percent' ? tf.rate(v) : tf.rps(v));
  const series: TimeSeries[] | undefined = d
    ? (d.metric === 'latency' ? sortLatency(d.series) : d.series).map((s) => ({
        id: s.id,
        label: t(`tr.series.${s.id}`),
        color: SERIES_COLOR[s.id],
        area: d.metric === 'requests' || d.metric === 'errors',
        points: s.points.map((p) => ({ t: p.t, v: p.value })),
      }))
    : undefined;

  const stats: MetricStat[] | undefined = d
    ? [
        { label: t('ui.chart.current'), value: fmt(d.current) },
        { label: t(`tr.chart.average.${d.metric}`), value: fmt(d.average) },
        { label: t('ui.chart.peak'), value: d.peakAt !== null ? `${fmt(d.peak)} · ${formatTime(d.peakAt, false)}` : fmt(d.peak) },
      ]
    : undefined;

  const now = q.dataUpdatedAt || Date.now();
  return (
    <MetricChart
      title={title}
      hint={d ? t('tr.chart.step', { seconds: d.stepSec }) : undefined}
      className={className}
      metrics={metrics.map((m) => ({ id: m, label: t(`tr.chart.metric.${m}`) }))}
      value={metric}
      onChange={setMetric}
      series={series}
      error={d ? undefined : q.error}
      onRetry={() => void q.refetch()}
      stats={stats}
      actions={actions}
      format={fmt}
      height={height}
      kind={d?.metric === 'status' ? 'bar' : 'line'}
      stacked={d?.metric === 'status'}
      legend={d?.metric === 'status' || d?.metric === 'latency'}
      thresholds={
        d?.metric === 'latency' && latencyThresholdMs !== undefined
          ? [{ value: latencyThresholdMs, label: t('tr.chart.threshold', { value: tf.latency(latencyThresholdMs) }), tone: 'warn' }]
          : undefined
      }
      emptyMessage={t('tr.chart.empty')}
      group={CHART_GROUP}
      xRange={{ from: now - TIME_RANGE_MS[filters.range], to: now }}
    />
  );
}

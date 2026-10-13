import React from 'react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { CHART_GROUP, TIME_RANGE_MS } from '@core/constants/ui.constants';
import { MetricChart, type ChartColor, type TimeSeries } from '@core/ui/charts';
import { performanceApi } from '../../services/performance.api';
import type { PerfMetric, PerfRange } from '../../types/performance.types';

interface OverviewChartProps {
  metric: PerfMetric;
  color: ChartColor;
  range: PerfRange;
}

/** Một biểu đồ nhỏ trên trang Tổng quan: series chính + hiện tại / trung bình / đỉnh. */
export const OverviewChart: React.FC<OverviewChartProps> = ({ metric, color, range }) => {
  const { t } = useLocale();
  const f = useFormat();
  const q = useLiveQuery(['overview', 'perf', metric, range], () => performanceApi.timeseries({ range, metric }));
  const d = q.data;
  const unit = d?.unit ?? '';
  const fmt = (v: number | null) => f.withUnit(v, unit);

  const series: TimeSeries[] | undefined = d?.series
    .filter((s) => s.kind === 'main')
    .map((s, i) => ({ id: s.id, label: s.label, color: i === 0 ? color : undefined, area: i === 0, points: s.points.map((p) => ({ t: p.t, v: p.value })) }));

  const now = q.dataUpdatedAt || Date.now();
  return (
    <MetricChart
      title={t(`ov.page.metric.${metric}`)}
      series={series}
      error={q.error}
      onRetry={() => void q.refetch()}
      stats={
        d
          ? [
              { label: t('ui.chart.current'), value: fmt(d.stats.current) },
              { label: t('ui.chart.average'), value: fmt(d.stats.avg) },
              { label: t('ui.chart.peak'), value: fmt(d.stats.peak) },
            ]
          : undefined
      }
      format={fmt}
      height="sm"
      group={CHART_GROUP}
      xRange={{ from: now - TIME_RANGE_MS[range], to: now }}
    />
  );
};

import { useMemo, useState } from 'react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery, useTimeRange } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { TIME_RANGE_MS } from '@core/constants/ui.constants';
import { MetricChart, type ChartThreshold, type TimeSeries } from '@core/ui/charts';
import type { RuntimeId, RuntimeThresholds } from '../../types/runtime.types';
import { runtimesApi } from '../../services/runtimes.api';
import { RUNTIME_CHART_FIELD, RUNTIME_CHART_METRICS, RUNTIME_COLOR, RUNTIME_RANGES, type RuntimeChartMetric } from '../../constants/runtime-metrics';
import { runtimesKeys } from '../../sections/runtimes/runtimes-keys';

interface RuntimeMetricChartProps {
  /** Cố định một runtime (trang chi tiết); bỏ trống = so sánh mọi runtime. */
  runtime?: RuntimeId;
  names: Partial<Record<RuntimeId, string>>;
  /** Có → vẽ đường ngưỡng cảnh báo (CPU, event loop). */
  thresholds?: RuntimeThresholds;
  height?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** CPU / RAM / event loop / restart theo thời gian (Prometheus, mỗi runtime một mẫu 15 giây). Bấm chú thích để ẩn / hiện runtime. */
export function RuntimeMetricChart({ runtime, names, thresholds, height, className }: RuntimeMetricChartProps) {
  const { t } = useLocale();
  const f = useFormat();
  const range = useTimeRange(RUNTIME_RANGES);
  const [metric, setMetric] = useState<RuntimeChartMetric>('cpu');
  const query = useLiveQuery(runtime ? runtimesKeys.runtimeSeries(runtime, range) : runtimesKeys.series(range), () =>
    runtime ? runtimesApi.runtimeSeries(runtime, range) : runtimesApi.series(range),
  );

  const series = useMemo<TimeSeries[] | undefined>(() => {
    if (!query.data) return undefined;
    const field = RUNTIME_CHART_FIELD[metric];
    return (Object.keys(query.data) as RuntimeId[])
      .filter((id) => !runtime || id === runtime)
      .map((id) => ({
        id,
        label: names[id] ?? t(`rt.name.${id}`),
        color: RUNTIME_COLOR[id],
        area: Boolean(runtime),
        points: (query.data?.[id] ?? []).map((s) => ({ t: s.t, v: s[field] })),
      }));
  }, [query.data, metric, runtime, names, t]);

  const format = (v: number | null) => (metric === 'cpu' ? f.percent(v) : metric === 'memory' ? f.mb(v) : metric === 'eventLoop' ? f.duration(v) : f.number(v));
  const lines: ChartThreshold[] = !thresholds
    ? []
    : metric === 'cpu'
      ? [{ value: thresholds.cpuPercent, label: t('ui.chart.threshold'), tone: 'warn' }]
      : metric === 'eventLoop'
        ? [{ value: thresholds.eventLoopMs, label: t('ui.chart.threshold'), tone: 'warn' }]
        : [];
  const now = query.dataUpdatedAt || Date.now();

  return (
    <MetricChart
      title={t('rt.chart.title')}
      hint={t('rt.chart.hint')}
      metrics={RUNTIME_CHART_METRICS.map((id) => ({ id, label: t(`rt.chart.metric.${id}`) }))}
      value={metric}
      onChange={setMetric}
      series={series}
      error={query.error}
      onRetry={() => void query.refetch()}
      format={format}
      kind={metric === 'restarts' ? 'bar' : 'line'}
      thresholds={lines}
      legend={!runtime}
      yMin={0}
      xRange={{ from: now - TIME_RANGE_MS[range], to: now }}
      emptyMessage={t('rt.chart.empty')}
      height={height}
      className={className}
    />
  );
}

import { useMemo, useState } from 'react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { TIME_RANGE_MS } from '@core/constants/ui.constants';
import { MetricChart, type ChartColor, type TimeSeries } from '@core/ui/charts';
import type { SchedulerMetric, SchedulerRange } from '../../types/scheduler.types';
import { schedulerApi } from '../../services/scheduler.api';
import { SCHEDULER_METRICS, SCHEDULER_SERIES_COLOR } from '../../constants/scheduler';
import { schedulerKeys } from '../../sections/scheduler/scheduler-keys';

/** Hoạt động Scheduler theo thời gian (lần chạy / thời lượng / lỗi) — toàn bộ hoặc một task — kèm hiện tại / đỉnh / trung bình. */
export function SchedulerActivityChart({ range, task = null, className }: { range: SchedulerRange; task?: string | null; className?: string }) {
  const { t } = useLocale();
  const f = useFormat();
  const [metric, setMetric] = useState<SchedulerMetric>('executions');
  const query = useLiveQuery(schedulerKeys.metrics(range, metric, task), () => schedulerApi.metrics(range, metric, task ?? undefined));
  const d = query.data;
  const fmt = (v: number | null) => (v === null ? NO_VALUE : d?.unit === 'ms' ? f.duration(v) : f.compact(v));
  const series: TimeSeries[] | undefined = useMemo(
    () =>
      d?.series.map((s) => ({
        id: s.id,
        label: s.label,
        color: (SCHEDULER_SERIES_COLOR as Record<string, ChartColor>)[s.id],
        points: s.points.map((p) => ({ t: p.t, v: p.value })),
      })),
    [d],
  );
  /** Trục X = đúng khoảng đã chọn, tính tới lúc tải dữ liệu. */
  const loadedAt = query.dataUpdatedAt;
  const xRange = useMemo(() => ({ from: loadedAt - TIME_RANGE_MS[range], to: loadedAt }), [range, loadedAt]);
  const counts = d?.unit !== 'ms';
  return (
    <MetricChart
      title={t('sch.chart.title')}
      hint={t(`sch.chart.note.${metric}`)}
      className={className}
      metrics={SCHEDULER_METRICS.map((m) => ({ id: m, label: t(`sch.chart.metric.${m}`) }))}
      value={metric}
      onChange={setMetric}
      series={series}
      error={query.error}
      onRetry={() => void query.refetch()}
      stats={
        d
          ? [
              { label: t('ui.chart.current'), value: fmt(d.stats.current) },
              { label: t('ui.chart.peak'), value: fmt(d.stats.peak) },
              { label: t('ui.chart.average'), value: fmt(d.stats.average) },
            ]
          : undefined
      }
      kind={counts ? 'bar' : 'line'}
      stacked={counts}
      legend={(series?.length ?? 0) > 1}
      xRange={xRange}
      format={fmt}
      emptyMessage={t('sch.chart.empty')}
    />
  );
}

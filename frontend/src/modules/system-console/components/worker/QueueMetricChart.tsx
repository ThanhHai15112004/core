import { useMemo, useState } from 'react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { CHART_GROUP, TIME_RANGE_MS } from '@core/constants/ui.constants';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@core/ui/primitives';
import { MetricChart, type MetricStat, type TimeSeries } from '@core/ui/charts';
import type { WorkerMetric, WorkerRange } from '../../types/worker.types';
import { workerApi } from '../../services/worker.api';
import { WORKER_METRICS, WORKER_SERIES_COLOR } from '../../constants/worker';
import { workerKeys } from '../../sections/worker/worker-keys';
import { formatWorkerUnit } from './worker-ui';

const ALL = '__all__';

interface Props {
  range: WorkerRange;
  title: string;
  /** Queue cố định (trang chi tiết queue) → không hiện bộ chọn queue. */
  queue?: string;
  /** Danh sách queue cho bộ chọn (≥ 2 mới hiện). */
  queues?: string[];
  metrics?: WorkerMetric[];
  initial?: WorkerMetric;
  className?: string;
}

/** Biểu đồ hiệu năng queue: throughput (nhận vào vs hoàn tất), job chờ, thời gian xử lý, lỗi, retry. */
export function QueueMetricChart({ range, title, queue: fixed, queues = [], metrics = WORKER_METRICS, initial, className }: Props) {
  const { t } = useLocale();
  const f = useFormat();
  const [metric, setMetric] = useState<WorkerMetric>(initial ?? metrics[0]);
  const [picked, setPicked] = useState(ALL);
  const queue = fixed ?? (picked === ALL ? undefined : picked);
  const q = useLiveQuery(workerKeys.metrics(range, metric, queue), () => workerApi.metrics(range, metric, queue));
  const d = q.data;
  const unit = d?.unit ?? '';

  const series: TimeSeries[] | undefined = useMemo(
    () =>
      d?.series.map((s, i) => ({
        id: s.id,
        label: s.label,
        color: WORKER_SERIES_COLOR[s.id],
        area: i === 0 && metric !== 'duration',
        axis: s.unit !== unit ? ('right' as const) : undefined,
        points: s.points.map((p) => ({ t: p.t, v: p.value })),
      })),
    [d, unit, metric],
  );

  const first = d?.series[0]?.points ?? [];
  const values = first.map((p) => p.value);
  const stats: MetricStat[] | undefined =
    d && values.length > 0
      ? [
          { label: t('ui.chart.current'), value: formatWorkerUnit(f, unit, values[values.length - 1]!) },
          { label: t('ui.chart.average'), value: formatWorkerUnit(f, unit, values.reduce((a, b) => a + b, 0) / values.length) },
          { label: t('ui.chart.peak'), value: formatWorkerUnit(f, unit, Math.max(...values)) },
        ]
      : undefined;

  const now = q.dataUpdatedAt || Date.now();
  const rightUnit = d?.series.find((s) => s.unit !== unit)?.unit ?? unit;
  return (
    <MetricChart
      title={title}
      hint={t(`wq.chart.note.${metric}`)}
      className={className}
      metrics={metrics.map((m) => ({ id: m, label: t(`wq.chart.metric.${m}`) }))}
      value={metric}
      onChange={setMetric}
      actions={
        !fixed && queues.length > 1 ? (
          <Select value={picked} onValueChange={setPicked}>
            <SelectTrigger size="sm" className="hidden w-36 sm:flex" aria-label={t('wq.chart.queue')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('wq.chart.allQueues')}</SelectItem>
              {queues.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : undefined
      }
      series={series}
      error={q.error}
      onRetry={() => void q.refetch()}
      stats={stats}
      format={(v) => formatWorkerUnit(f, unit, v)}
      formatRight={(v) => formatWorkerUnit(f, rightUnit, v)}
      legend
      group={CHART_GROUP}
      emptyMessage={t('wq.chart.empty')}
      xRange={{ from: now - TIME_RANGE_MS[range], to: now }}
    />
  );
}

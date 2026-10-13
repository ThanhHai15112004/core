import { useMemo, useState } from 'react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { useFormat } from '@core/hooks/useFormat';
import { TIME_RANGE_MS } from '@core/constants/ui.constants';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, ToggleGroup, ToggleGroupItem } from '@core/ui/primitives';
import { Panel, PanelState } from '@core/ui/blocks';
import { TimeSeriesChart, type MetricStat, type TimeSeries } from '@core/ui/charts';
import type { JobsRange } from '../../types/jobs.types';
import type { RateBalance, WorkerMetric } from '../../types/worker.types';
import { workerApi } from '../../services/worker.api';
import { JOB_METRICS, JOB_SERIES_COLOR } from '../../constants/jobs';
import { jobsKeys } from './jobs-keys';

const ALL = '__all__';

/** Hoạt động job theo thời gian (nhận vào / hoàn tất / lỗi, job chờ, thời gian xử lý, lỗi, retry) + cân bằng vào / ra. */
export function JobsActivityChart({ range, queues, rate }: { range: JobsRange; queues: string[]; rate: RateBalance | undefined }) {
  const { t } = useLocale();
  const f = useFormat();
  const [metric, setMetric] = useState<WorkerMetric>(JOB_METRICS[0]);
  const [queue, setQueue] = useState<string | null>(null);
  const q = useLiveQuery(jobsKeys.metrics(range, metric, queue), () => workerApi.metrics(range, metric, queue ?? undefined));

  const firstUnit = q.data?.series[0]?.unit ?? '';
  const fmt = useMemo(
    () => (unit: string) => (v: number | null) => (unit === 'ms' ? f.duration(v) : unit === '/min' ? f.rate(v, 'min') : f.compact(v)),
    [f],
  );
  const series: TimeSeries[] | undefined = useMemo(
    () =>
      q.data?.series.map((s, i) => ({
        id: s.id,
        label: s.label,
        color: JOB_SERIES_COLOR[s.id],
        axis: s.unit !== firstUnit ? 'right' : 'left',
        points: s.points.map((p) => ({ t: p.t, v: p.value })),
        area: i === 0,
      })),
    [q.data, firstUnit],
  );
  const rightUnit = q.data?.series.find((s) => s.unit !== firstUnit)?.unit;
  const now = q.dataUpdatedAt || undefined;

  const stats: MetricStat[] | undefined = rate
    ? [
        { label: t('jobs.rate.incoming'), value: f.rate(rate.incomingPerMin, 'min') },
        { label: t('jobs.rate.completed'), value: f.rate(rate.processingPerMin, 'min') },
        {
          label: t('jobs.rate.diff'),
          value: `${rate.diffPerMin === null ? f.rate(null) : `${rate.diffPerMin > 0 ? '+' : ''}${f.rate(rate.diffPerMin, 'min')}`}${rate.state ? ` · ${t(`jobs.rate.state.${rate.state}`)}` : ''}`,
        },
      ]
    : undefined;

  return (
    <Panel title={t('jobs.chart.title')} hint={t(`jobs.chart.note.${metric}`)} expandable>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="max-w-full overflow-x-auto">
          <ToggleGroup type="single" value={metric} onValueChange={(v) => v && setMetric(v as WorkerMetric)} aria-label={t('ui.chart.metric')}>
            {JOB_METRICS.map((id) => (
              <ToggleGroupItem key={id} value={id}>
                {t(`jobs.chart.metric.${id}`)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        {queues.length > 1 && (
          <Select value={queue ?? ALL} onValueChange={(v) => setQueue(v === ALL ? null : v)}>
            <SelectTrigger size="sm" className="w-36" aria-label={t('jobs.filter.queue')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('jobs.filter.allQueues')}</SelectItem>
              {queues.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      {stats && (
        <dl className="mb-2 flex flex-wrap gap-x-5 gap-y-1">
          {stats.map((st) => (
            <div key={st.label} className="flex items-baseline gap-1.5">
              <dt className="text-xs text-muted">{st.label}</dt>
              <dd className="font-mono text-sm font-medium tabular-nums text-fg">{st.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {series === undefined ? (
        <PanelState status={q.isError ? 'error' : 'loading'} error={q.error} onRetry={() => void q.refetch()} skeleton="chart" />
      ) : (
        <TimeSeriesChart
          series={series}
          ariaLabel={t('jobs.chart.title')}
          format={fmt(firstUnit)}
          formatRight={rightUnit ? fmt(rightUnit) : undefined}
          legend
          xRange={now ? { from: now - TIME_RANGE_MS[range], to: now } : undefined}
          emptyMessage={t('jobs.chart.empty')}
        />
      )}
    </Panel>
  );
}

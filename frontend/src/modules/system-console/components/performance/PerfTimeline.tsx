import { useMemo } from 'react';
import { Download } from 'lucide-react';
import { useLocale } from '@core/i18n/index';
import { useLiveQuery } from '@core/data';
import { TIME_RANGE_MS } from '@core/constants/ui.constants';
import { downloadCsv } from '@core/lib/csv';
import { NO_VALUE } from '@core/lib/format';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, ToggleGroup, ToggleGroupItem } from '@core/ui/primitives';
import { Panel, PanelState } from '@core/ui/blocks';
import { TimeSeriesChart, type ChartMarker, type TimeSeries } from '@core/ui/charts';
import type { PerfFilters, PerfMetric } from '../../types/performance.types';
import { performanceApi } from '../../services/performance.api';
import { BASELINE_COLOR, BASELINE_MODES, COMPARE_COLOR, EXTRA_METRICS, PERF_METRICS, PRIMARY_METRICS, SEVERITY_TONE } from '../../constants/performance';
import { perfKeys } from '../../sections/performance/performance-keys';
import { usePerfFormat } from './perf-format';

const NONE = 'none';

interface PerfTimelineProps {
  filters: PerfFilters;
  setFilters: (patch: Partial<Record<'metric' | 'compare' | 'baseline', string | undefined>>) => void;
}

/**
 * Biểu đồ chính: một chỉ số theo thời gian, chồng chỉ số khác trên trục phải để tìm tương quan,
 * baseline (kỳ trước / hôm qua / tuần trước) nét đứt và mốc sự kiện (restart, bắt đầu nghẽn).
 */
export function PerfTimeline({ filters, setFilters }: PerfTimelineProps) {
  const { t, formatTime } = useLocale();
  const fmt = usePerfFormat();
  const query = useLiveQuery(perfKeys.timeseries(filters), () => performanceApi.timeseries(filters));
  const d = query.data;
  const unit = d?.unit ?? '';
  const compareSeries = d?.series.find((s) => s.kind === 'compare');

  const series = useMemo<TimeSeries[]>(
    () =>
      (d?.series ?? []).map((s) => ({
        id: s.id,
        label: s.label,
        axis: s.axis,
        dashed: s.kind !== 'main',
        color: s.kind === 'compare' ? COMPARE_COLOR : s.kind === 'baseline' ? BASELINE_COLOR : undefined,
        points: s.points.map((p) => ({ t: p.t, v: p.value })),
      })),
    [d],
  );
  const markers = useMemo<ChartMarker[]>(() => (d?.markers ?? []).map((m) => ({ t: m.t, label: m.label, tone: SEVERITY_TONE[m.severity] })), [d]);

  const selectMetric = (metric: PerfMetric) => setFilters({ metric, compare: filters.compare === metric ? undefined : filters.compare });
  const exportCsv = () => {
    if (!d) return;
    const times = [...new Set(d.series.flatMap((s) => s.points.map((p) => p.t)))].sort((a, b) => a - b);
    const byId = d.series.map((s) => new Map(s.points.map((p) => [p.t, p.value])));
    downloadCsv(
      `performance-${filters.metric}-${filters.range}.csv`,
      [t('perf.timeline.csvTime'), ...d.series.map((s) => `${s.label} (${s.unit})`)],
      times.map((ts) => [new Date(ts).toISOString(), ...byId.map((m) => m.get(ts) ?? null)]),
    );
  };
  const now = query.dataUpdatedAt || Date.now();
  const stats = d
    ? [
        { label: t('ui.chart.current'), value: fmt(d.stats.current, unit) },
        { label: t('ui.chart.average'), value: fmt(d.stats.avg, unit) },
        { label: t('ui.chart.peak'), value: `${fmt(d.stats.peak, unit)}${d.stats.peakAt ? ` · ${formatTime(d.stats.peakAt)}` : ''}` },
      ]
    : [];

  return (
    <Panel
      title={t('perf.timeline.title')}
      hint={d?.resolutionSec ? t('perf.timeline.hint', { seconds: d.resolutionSec }) : undefined}
      expandable
      actions={
        <ToggleGroup type="single" value={PRIMARY_METRICS.includes(filters.metric) ? filters.metric : ''} onValueChange={(v) => v && selectMetric(v as PerfMetric)} aria-label={t('ui.chart.metric')} className="max-w-full overflow-x-auto">
          {PRIMARY_METRICS.map((m) => (
            <ToggleGroupItem key={m} value={m}>
              {t(`perf.metric.${m}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Select value={EXTRA_METRICS.includes(filters.metric) ? filters.metric : NONE} onValueChange={(v) => v !== NONE && selectMetric(v as PerfMetric)}>
          <SelectTrigger size="sm" aria-label={t('perf.timeline.moreMetrics')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('perf.timeline.moreMetrics')}</SelectItem>
            {EXTRA_METRICS.map((m) => (
              <SelectItem key={m} value={m}>
                {t(`perf.metric.${m}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.compare ?? NONE} onValueChange={(v) => setFilters({ compare: v === NONE ? undefined : v })}>
          <SelectTrigger size="sm" aria-label={t('perf.timeline.compare')}>
            <span className="text-muted">{t('perf.timeline.compare')}:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('perf.timeline.none')}</SelectItem>
            {PERF_METRICS.filter((m) => m !== filters.metric).map((m) => (
              <SelectItem key={m} value={m}>
                {t(`perf.metric.${m}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.baseline ?? NONE} onValueChange={(v) => setFilters({ baseline: v === NONE ? undefined : v })}>
          <SelectTrigger size="sm" aria-label={t('perf.timeline.baseline')}>
            <span className="text-muted">{t('perf.timeline.baseline')}:</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t('perf.timeline.none')}</SelectItem>
            {BASELINE_MODES.map((b) => (
              <SelectItem key={b} value={b}>
                {t(`perf.baseline.${b}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="ghost" onClick={exportCsv} disabled={!d}>
          <Download />
          {t('perf.timeline.export')}
        </Button>
        <dl className="ml-auto flex flex-wrap gap-x-4 gap-y-1">
          {stats.map((s) => (
            <div key={s.label} className="flex items-baseline gap-1.5">
              <dt className="text-xs text-muted">{s.label}</dt>
              <dd className="font-mono text-sm font-medium tabular-nums text-fg">{s.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {d ? (
        <>
          <TimeSeriesChart
            series={series}
            format={(v) => fmt(v, unit)}
            formatRight={compareSeries ? (v) => fmt(v, compareSeries.unit) : undefined}
            markers={markers}
            legend={series.length > 1}
            height="lg"
            yMin={0}
            xRange={{ from: now - TIME_RANGE_MS[filters.range], to: now }}
            emptyMessage={t('perf.timeline.empty')}
            ariaLabel={t('perf.timeline.title')}
          />
          {(compareSeries || d.baselineUnavailable) && (
            <p className="mt-1.5 text-xs text-faint">
              {compareSeries && t('perf.timeline.rightAxis', { label: compareSeries.label, unit: compareSeries.unit || NO_VALUE })}
              {d.baselineUnavailable && ` ${t('perf.timeline.baselineUnavailable')}`}
            </p>
          )}
        </>
      ) : (
        <PanelState status={query.isError ? 'error' : 'loading'} error={query.error} onRetry={() => void query.refetch()} skeleton="chart" />
      )}
    </Panel>
  );
}

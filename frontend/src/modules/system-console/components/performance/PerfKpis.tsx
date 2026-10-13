import { useLocale } from '@core/i18n/index';
import { NO_VALUE } from '@core/lib/format';
import type { Tone } from '@core/theme';
import { StatGrid, StatTile } from '@core/ui/blocks';
import type { Kpi, PerformanceOverview } from '../../types/performance.types';
import { KPI_RULES } from '../../constants/performance';
import { kpiDelta, usePerfFormat } from './perf-format';

const TILES = 6;

/** 6 KPI cấp hệ thống: trung bình trong khoảng đang chọn + thay đổi so với kỳ trước. */
export function PerfKpis({ data, loading }: { data: PerformanceOverview | undefined; loading: boolean }) {
  const { t } = useLocale();
  const fmt = usePerfFormat();
  if (!data) {
    return (
      <StatGrid columns={6}>
        {Array.from({ length: TILES }, (_, i) => (
          <StatTile key={i} label={NO_VALUE} value={NO_VALUE} loading={loading} />
        ))}
      </StatGrid>
    );
  }
  const { kpis, bottlenecks } = data;
  const range = t(`ui.time.ranges.${data.range}`);
  const toneFor = (rules: readonly string[], kpi: Kpi): Tone | undefined => {
    const hits = bottlenecks.filter((b) => rules.includes(b.rule));
    if (hits.some((b) => b.severity === 'critical')) return 'crit';
    if (hits.length) return 'warn';
    return kpi.value === null ? undefined : 'ok';
  };
  const mem = kpis.memoryMb;
  const avgHint = t('perf.kpi.avgOf', { range });

  return (
    <StatGrid columns={6}>
      <StatTile
        label={t('perf.kpi.apiP95')}
        value={fmt(kpis.apiP95Ms.value, 'ms')}
        sub={kpis.apiP95Ms.value === null ? t('perf.kpi.noRequests') : undefined}
        delta={kpiDelta(kpis.apiP95Ms.changePercent, true)}
        tone={toneFor(KPI_RULES.apiP95, kpis.apiP95Ms)}
        hint={avgHint}
      />
      <StatTile label={t('perf.kpi.throughput')} value={fmt(kpis.throughputPerSec.value, '/s')} delta={kpiDelta(kpis.throughputPerSec.changePercent, null)} hint={avgHint} />
      <StatTile
        label={t('perf.kpi.cpu')}
        value={fmt(kpis.cpuPercent.value, '%')}
        delta={kpiDelta(kpis.cpuPercent.changePercent, true)}
        tone={toneFor(KPI_RULES.cpu, kpis.cpuPercent)}
        hint={t('perf.kpi.cpuHint', { range })}
      />
      <StatTile
        label={t('perf.kpi.memory')}
        value={fmt(mem.value, 'MB')}
        sub={mem.limitMb ? t('perf.kpi.memoryOf', { limit: fmt(mem.limitMb, 'MB'), percent: fmt(mem.percent, '%') }) : undefined}
        delta={kpiDelta(mem.changePercent, true)}
        tone={toneFor(KPI_RULES.memory, mem)}
        hint={t('perf.kpi.memoryHint')}
      />
      <StatTile
        label={t('perf.kpi.errorRate')}
        value={fmt(kpis.errorRatePercent.value, '%')}
        sub={kpis.errorRatePercent.value === null ? t('perf.kpi.noRequests') : undefined}
        delta={kpiDelta(kpis.errorRatePercent.changePercent, true)}
        tone={toneFor(KPI_RULES.errorRate, kpis.errorRatePercent)}
        hint={t('perf.kpi.errorHint')}
      />
      <StatTile
        label={t('perf.kpi.bottlenecks')}
        value={String(kpis.bottlenecks.count)}
        sub={kpis.bottlenecks.components.join(', ') || undefined}
        tone={bottlenecks.some((b) => b.severity === 'critical') ? 'crit' : bottlenecks.length ? 'warn' : 'ok'}
      />
    </StatGrid>
  );
}

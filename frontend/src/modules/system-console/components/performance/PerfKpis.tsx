import React from 'react';
import type { Kpi, PerformanceOverview } from '../../types/performance.types';
import { formatUnit, trendOf } from '../../utils/performance-format';
import type { StatusTone } from '../../utils/status-tone';
import { useLocale } from '../../../../core/i18n/index';

interface Item {
  key: string;
  value: string;
  sub: string;
  tone: StatusTone;
  trend: ReturnType<typeof trendOf>;
}

/** 6 KPI cấp hệ thống, trung bình trong khoảng đang chọn và so với kỳ trước. */
export const PerfKpis: React.FC<{ data: PerformanceOverview | null }> = ({ data }) => {
  const { t } = useLocale();

  if (!data) {
    return (
      <div className="ov-kpi-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="ov-card ov-kpi">
            <span className="ov-skeleton" style={{ width: '60%', height: 12 }} />
            <span className="ov-skeleton" style={{ width: '45%', height: 28, marginTop: 14 }} />
          </div>
        ))}
      </div>
    );
  }

  const { kpis, bottlenecks } = data;
  const range = t(`tr.range.${data.range}`);
  const toneFor = (rules: string[], kpi: Kpi): StatusTone => {
    const hits = bottlenecks.filter((b) => rules.includes(b.rule));
    if (hits.some((b) => b.severity === 'critical')) return 'crit';
    if (hits.length) return 'warn';
    return kpi.value === null ? 'unknown' : 'ok';
  };
  const avgSub = t('perf.kpi.avgOf', { range });
  const mem = kpis.memoryMb;

  const items: Item[] = [
    {
      key: 'apiP95',
      value: formatUnit(kpis.apiP95Ms.value, 'ms'),
      sub: kpis.apiP95Ms.value === null ? t('perf.kpi.noRequests') : avgSub,
      tone: toneFor(['API_LATENCY_P95', 'API_LATENCY_P99'], kpis.apiP95Ms),
      trend: trendOf(kpis.apiP95Ms.changePercent, true),
    },
    {
      key: 'throughput',
      value: kpis.throughputPerSec.value === null ? formatUnit(null, '') : `${formatUnit(kpis.throughputPerSec.value, '/s').replace('/s', '')} req/s`,
      sub: avgSub,
      tone: 'unknown',
      trend: trendOf(kpis.throughputPerSec.changePercent, null),
    },
    {
      key: 'cpu',
      value: formatUnit(kpis.cpuPercent.value, '%'),
      sub: t('perf.kpi.cpuSub', { range }),
      tone: toneFor(['CPU_HIGH'], kpis.cpuPercent),
      trend: trendOf(kpis.cpuPercent.changePercent, true),
    },
    {
      key: 'memory',
      value: mem.limitMb ? `${formatUnit(mem.value, 'MB')} / ${formatUnit(mem.limitMb, 'MB')}` : formatUnit(mem.value, 'MB'),
      sub: mem.percent === null ? t('perf.kpi.memorySub') : t('perf.kpi.memoryPercent', { percent: formatUnit(mem.percent, '%') }),
      tone: toneFor(['MEMORY_HIGH', 'MEMORY_GROWTH'], mem),
      trend: trendOf(mem.changePercent, true),
    },
    {
      key: 'errorRate',
      value: formatUnit(kpis.errorRatePercent.value, '%'),
      sub: kpis.errorRatePercent.value === null ? t('perf.kpi.noRequests') : t('perf.kpi.errorSub'),
      tone: toneFor(['API_ERROR_RATE'], kpis.errorRatePercent),
      trend: trendOf(kpis.errorRatePercent.changePercent, true),
    },
    {
      key: 'bottlenecks',
      value: String(kpis.bottlenecks.count),
      sub: kpis.bottlenecks.count ? kpis.bottlenecks.components.join(', ') : t('perf.kpi.noBottlenecks'),
      tone: bottlenecks.some((b) => b.severity === 'critical') ? 'crit' : bottlenecks.length ? 'warn' : 'ok',
      trend: null,
    },
  ];

  return (
    <div className="ov-kpi-grid">
      {items.map((item) => (
        <div key={item.key} className={`ov-card ov-kpi ov-tone-${item.tone}`}>
          <span className="ov-kpi-label">{t(`perf.kpi.${item.key}`)}</span>
          <span className="ov-kpi-value">{item.value}</span>
          {item.trend && (
            <span className={`ov-kpi-trend is-${item.trend.tone}`}>{t('perf.kpi.vsPrevious', { delta: item.trend.text })}</span>
          )}
          <span className="ov-kpi-sub">{item.sub}</span>
        </div>
      ))}
    </div>
  );
};

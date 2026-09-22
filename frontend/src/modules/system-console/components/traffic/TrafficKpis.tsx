import React from 'react';
import type { TrafficSummary } from '../../types/traffic.types';
import { formatCount, formatDelta, formatMs, formatPct, formatRps } from '../../utils/traffic-format';
import { useLocale } from '../../../../core/i18n/index';

interface Kpi {
  key: string;
  value: string;
  sub: string;
  tone: 'ok' | 'warn' | 'crit' | 'unknown';
  trend?: { text: string; good: boolean } | null;
}

/** 6 KPI: tốc độ request, P50, P95, tỷ lệ lỗi, đang xử lý, hôm nay — số của khoảng thời gian đang chọn. */
export const TrafficKpis: React.FC<{ summary: TrafficSummary | null }> = ({ summary }) => {
  const { t, locale } = useLocale();

  if (!summary) {
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

  const { stats, comparison: cmp, settings } = summary;
  const range = t(`tr.range.${summary.range}`);
  const requestsDelta = formatDelta(cmp.requestsPercent);
  const p95Delta = formatDelta(cmp.p95Percent);
  const errDelta = formatDelta(cmp.errorRateDelta, ' pp');
  const p95Slow = stats.p95LatencyMs !== null && stats.p95LatencyMs > settings.endpointP95WarnMs;

  const items: Kpi[] = [
    {
      key: 'rate',
      value: `${formatRps(stats.requestsPerSecond)} req/s`,
      sub: t('tr.kpi.rateSub', { count: formatCount(stats.requests, locale), range }),
      tone: 'unknown',
      trend: requestsDelta ? { text: t('tr.kpi.vsPrevious', { delta: requestsDelta }), good: true } : null,
    },
    {
      key: 'p50',
      value: formatMs(stats.p50LatencyMs),
      sub: t('tr.kpi.avg', { value: formatMs(stats.avgLatencyMs) }),
      tone: 'unknown',
    },
    {
      key: 'p95',
      value: formatMs(stats.p95LatencyMs),
      sub: p95Slow
        ? t('tr.kpi.overThreshold', { threshold: formatMs(settings.endpointP95WarnMs) })
        : t('tr.kpi.p99', { value: formatMs(stats.p99LatencyMs) }),
      tone: stats.p95LatencyMs === null ? 'unknown' : p95Slow ? 'warn' : 'ok',
      trend: p95Delta ? { text: t('tr.kpi.vsPrevious', { delta: p95Delta }), good: (cmp.p95Percent ?? 0) <= 0 } : null,
    },
    {
      key: 'errorRate',
      value: formatPct(stats.errorRatePercent),
      sub: t('tr.kpi.errorSub', {
        errors: formatCount(stats.serverErrors, locale),
        total: formatCount(stats.requests, locale),
        client: formatCount(stats.clientErrors, locale),
      }),
      tone:
        stats.errorRatePercent >= settings.errorRateCritPercent
          ? 'crit'
          : stats.errorRatePercent >= settings.errorRateWarnPercent
            ? 'warn'
            : stats.requests > 0
              ? 'ok'
              : 'unknown',
      trend: errDelta ? { text: t('tr.kpi.vsPrevious', { delta: errDelta }), good: (cmp.errorRateDelta ?? 0) <= 0 } : null,
    },
    {
      key: 'active',
      value: String(summary.activeRequests),
      sub: t('tr.kpi.peak', { value: summary.peakActiveRequests, range }),
      tone: 'unknown',
    },
    {
      key: 'today',
      value: formatCount(summary.requestsToday, locale),
      sub: t('tr.kpi.todaySub'),
      tone: 'unknown',
    },
  ];

  return (
    <div className="ov-kpi-grid">
      {items.map((item) => (
        <div key={item.key} className={`ov-card ov-kpi ov-tone-${item.tone}`}>
          <span className="ov-kpi-label">{t(`tr.kpi.${item.key}`)}</span>
          <span className="ov-kpi-value">{item.value}</span>
          {item.trend && <span className={`ov-kpi-trend is-${item.trend.good ? 'good' : 'bad'}`}>{item.trend.text}</span>}
          <span className="ov-kpi-sub">{item.sub}</span>
        </div>
      ))}
    </div>
  );
};

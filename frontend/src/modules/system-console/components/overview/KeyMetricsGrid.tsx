import React from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import type { KeyMetricItem } from '../../types/console.types';
import type { MetricTrend } from '../../hooks/useMetricHistory';
import { toneOf } from '../../utils/status-tone';
import { useLocale } from '../../../../core/i18n/index';

interface KeyMetricsGridProps {
  metrics: KeyMetricItem[];
  trends: Record<string, MetricTrend | null>;
  isLoading?: boolean;
}

const LABEL_KEYS: Record<string, string> = {
  req_sec: 'kpi.reqSec',
  p95_lat: 'kpi.p95Latency',
  err_rate: 'kpi.errorRate',
  cpu_load: 'kpi.cpuUsage',
  mem_usage: 'kpi.memoryUsage',
  alerts_count: 'kpi.activeAlerts',
};

/* Tăng là xấu với các metric này; với lưu lượng thì trung tính. */
const HIGHER_IS_WORSE = new Set(['p95_lat', 'err_rate', 'cpu_load', 'mem_usage']);

const SKELETON_COUNT = 6;

/** Vùng ②: 6 KPI vận hành. */
export const KeyMetricsGrid: React.FC<KeyMetricsGridProps> = ({ metrics, trends, isLoading }) => {
  const { t } = useLocale();

  if (isLoading && metrics.every((m) => m.value === '--')) {
    return (
      <div className="ov-kpi-grid" aria-busy="true">
        {Array.from({ length: SKELETON_COUNT }, (_, i) => (
          <div key={i} className="ov-card ov-kpi">
            <span className="ov-skeleton" style={{ width: '60%', height: 12 }} />
            <span className="ov-skeleton" style={{ width: '45%', height: 28, marginTop: 14 }} />
            <span className="ov-skeleton" style={{ width: '75%', height: 10, marginTop: 14 }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="ov-kpi-grid">
      {metrics.map((metric) => {
        const trend = trends[metric.id];
        const trendTone =
          trend && trend.delta !== 0 && HIGHER_IS_WORSE.has(metric.id) ? (trend.delta > 0 ? 'bad' : 'good') : 'neutral';

        return (
          <div key={metric.id} className={`ov-card ov-kpi ov-tone-${toneOf(metric.status)}`}>
            <span className="ov-kpi-label">{LABEL_KEYS[metric.id] ? t(LABEL_KEYS[metric.id]!) : metric.label}</span>
            <span className="ov-kpi-value">
              {metric.value}
              {metric.unit && metric.value !== '--' && <small>{metric.unit}</small>}
            </span>
            {trend && trend.delta !== 0 ? (
              <span className={`ov-kpi-trend is-${trendTone}`}>
                {trend.delta > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                {t('ov.kpi.trend', {
                  change: trend.deltaPercent !== null ? `${Math.abs(trend.deltaPercent)}%` : Math.abs(trend.delta),
                  minutes: trend.minutesAgo,
                })}
              </span>
            ) : (
              <span className="ov-kpi-sub">{metric.trendText}</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

import React from 'react';
import type { KeyMetricItem } from '../../types/console.types';

import { useLocale } from '../../../../core/i18n/index';

interface KeyMetricsGridProps {
  metrics: KeyMetricItem[];
  isLoading?: boolean;
}

export const KeyMetricsGrid: React.FC<KeyMetricsGridProps> = ({
  metrics,
  isLoading = false,
}) => {
  const { t } = useLocale();

  const getMetricLabel = (item: KeyMetricItem) => {
    switch (item.id) {
      case 'req_sec':
        return t('kpi.reqSec');
      case 'p95_lat':
        return t('kpi.p95Latency');
      case 'err_rate':
        return t('kpi.errorRate');
      case 'cpu_load':
        return t('kpi.cpuUsage');
      case 'mem_usage':
        return t('kpi.memoryUsage');
      case 'alerts_count':
        return t('kpi.activeAlerts');
      default:
        return item.label;
    }
  };

  if (isLoading) {
    return (
      <section className="overview-kpi-grid" aria-label="Key System Metrics Loading">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div key={idx} className="kpi-metric-card">
            <div className="scp-skeleton" style={{ width: '60%', height: '14px', marginBottom: '8px' }} />
            <div className="scp-skeleton" style={{ width: '80%', height: '32px', marginBottom: '8px' }} />
            <div className="scp-skeleton" style={{ width: '45%', height: '14px' }} />
          </div>
        ))}
      </section>
    );
  }

  return (
    <section className="overview-kpi-grid" aria-label="Key System Metrics">
      {metrics.map((metric) => {
        const trendClass =
          metric.trendDirection === 'neutral'
            ? 'trend-neutral'
            : metric.trendIsGood
            ? 'trend-good'
            : 'trend-bad';

        const cardStatusClass =
          metric.status === 'critical'
            ? 'is-critical'
            : metric.status === 'warning'
            ? 'is-warning'
            : '';

        return (
          <div key={metric.id} className={`kpi-metric-card ${cardStatusClass}`}>
            <div className="kpi-card-header">
              <span>{getMetricLabel(metric)}</span>
            </div>

            <div className="kpi-card-value-wrap">
              <span className="kpi-card-value">{metric.value}</span>
              {metric.unit && <span className="kpi-card-unit">{metric.unit}</span>}
            </div>

            <div className={`kpi-card-trend ${trendClass}`}>
              <span>{metric.trendText}</span>
            </div>
          </div>
        );
      })}
    </section>
  );
};

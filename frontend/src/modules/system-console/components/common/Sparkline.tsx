import React from 'react';
import type { LatencyDataPoint } from '../../types/console.types';
import { useLocale } from '../../../../core/i18n/index';

interface SparklineProps {
  data: LatencyDataPoint[] | number[];
  color?: string;
  height?: number;
}

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  color = 'var(--scp-primary)',
  height = 28,
}) => {
  const { t } = useLocale();
  if (!data || data.length === 0) {
    return <div style={{ height, color: 'var(--scp-text-muted)', fontSize: '0.75rem' }}>{t('console.fallback.noData')}</div>;
  }

  const values = data.map((d) => (typeof d === 'number' ? d : d.latencyMs));
  const minVal = Math.min(...values, 0);
  const maxVal = Math.max(...values, 10);
  const range = maxVal - minVal || 1;

  return (
    <div className="sparkline-container" style={{ height }}>
      {data.map((item, idx) => {
        const val = typeof item === 'number' ? item : item.latencyMs;
        const time = typeof item === 'number' ? `#${idx + 1}` : item.time;
        // height percentage between 15% and 100%
        const pct = Math.max(15, Math.round(((val - minVal) / range) * 100));

        return (
          <div
            key={idx}
            className="sparkline-bar"
            style={{
              height: `${pct}%`,
              backgroundColor: val > 60 ? 'var(--scp-danger)' : val > 30 ? 'var(--scp-warning)' : color,
            }}
            title={`${time}: ${val}ms`}
          />
        );
      })}
    </div>
  );
};

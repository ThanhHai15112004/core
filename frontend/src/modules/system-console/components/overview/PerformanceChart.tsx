import React, { useState, useMemo } from 'react';
import type {
  PerformanceMetricKey,
  PerformanceTimeRange,
  PerformanceDataPoint,
} from '../../types/console.types';

import { useLocale } from '../../../../core/i18n/index';

interface PerformanceChartProps {
  activeMetric: PerformanceMetricKey;
  onMetricChange: (metric: PerformanceMetricKey) => void;
  timeRange: PerformanceTimeRange;
  onTimeRangeChange: (range: PerformanceTimeRange) => void;
  series: PerformanceDataPoint[];
  stats: { current: string; average: string; peak: string };
}

const METRIC_KEYS: PerformanceMetricKey[] = ['requests', 'latency', 'errors', 'cpu', 'memory'];
const TIME_TABS: PerformanceTimeRange[] = ['15m', '1h', '6h', '24h'];

export const PerformanceChart: React.FC<PerformanceChartProps> = ({
  activeMetric,
  onMetricChange,
  timeRange,
  onTimeRangeChange,
  series,
  stats,
}) => {
  const { t } = useLocale();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const getMetricLabel = (key: PerformanceMetricKey) => {
    switch (key) {
      case 'requests':
        return t('chart.requests');
      case 'latency':
        return t('chart.latency');
      case 'errors':
        return t('chart.errors');
      case 'cpu':
        return t('chart.cpu');
      case 'memory':
        return t('chart.memory');
    }
  };

  const { points, areaPath, linePath } = useMemo(() => {
    if (!series || series.length === 0) {
      return { points: [], areaPath: '', linePath: '' };
    }

    const width = 600;
    const height = 180;
    const paddingX = 20;
    const paddingTop = 15;
    const paddingBottom = 25;
    const usableHeight = height - paddingTop - paddingBottom;
    const usableWidth = width - paddingX * 2;

    const values = series.map((s) => s.value);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const buffer = (rawMax - rawMin) * 0.15 || 5;
    const min = Math.max(0, rawMin - buffer);
    const max = rawMax + buffer;

    const coords = series.map((item, idx) => {
      const x = paddingX + (idx / (series.length - 1 || 1)) * usableWidth;
      const normalizedY = max > min ? (item.value - min) / (max - min) : 0.5;
      const y = height - paddingBottom - normalizedY * usableHeight;
      return { x, y, item };
    });

    let lPath = '';
    coords.forEach((pt, idx) => {
      lPath += idx === 0 ? `M ${pt.x},${pt.y}` : ` L ${pt.x},${pt.y}`;
    });

    const aPath = `${lPath} L ${coords[coords.length - 1]?.x ?? width},${height - paddingBottom} L ${coords[0]?.x ?? 0},${height - paddingBottom} Z`;

    return {
      points: coords,
      areaPath: aPath,
      linePath: lPath,
      minVal: Math.round(min),
      maxVal: Math.round(max),
    };
  }, [series]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const ratio = mouseX / rect.width;
    const idx = Math.min(
      Math.max(0, Math.round(ratio * (series.length - 1))),
      series.length - 1,
    );
    setHoverIndex(idx);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  const hoveredPoint = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div className="perf-chart-panel">
      {/* Header: Metric Switcher & Time Range */}
      <div className="perf-chart-header">
        <div className="perf-metric-tabs">
          {METRIC_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              className={`perf-tab-btn ${activeMetric === key ? 'is-active' : ''}`}
              onClick={() => onMetricChange(key)}
            >
              {getMetricLabel(key)}
            </button>
          ))}
        </div>

        <div className="perf-time-tabs">
          {TIME_TABS.map((range) => (
            <button
              key={range}
              type="button"
              className={`perf-time-btn ${timeRange === range ? 'is-active' : ''}`}
              onClick={() => onTimeRangeChange(range)}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Summary Bar */}
      <div className="perf-stats-bar">
        <div className="perf-stat-item">
          <span className="perf-stat-label">{t('chart.current')}:</span>
          <span className="perf-stat-value">{stats.current}</span>
        </div>
        <div className="perf-stat-item">
          <span className="perf-stat-label">{t('chart.average')}:</span>
          <span className="perf-stat-value">{stats.average}</span>
        </div>
        <div className="perf-stat-item">
          <span className="perf-stat-label">{t('chart.peak')}:</span>
          <span className="perf-stat-value">{stats.peak}</span>
        </div>
      </div>

      {/* Interactive SVG Chart */}
      <div className="perf-svg-wrapper">
        <svg
          viewBox="0 0 600 180"
          preserveAspectRatio="none"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ cursor: 'crosshair' }}
        >
          <defs>
            <linearGradient id="perfChartAreaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--scp-chart-fill-start)" />
              <stop offset="100%" stopColor="var(--scp-chart-fill-end)" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          <line
            x1="20"
            y1="30"
            x2="580"
            y2="30"
            stroke="var(--scp-chart-grid)"
            strokeDasharray="4 4"
          />
          <line
            x1="20"
            y1="90"
            x2="580"
            y2="90"
            stroke="var(--scp-chart-grid)"
            strokeDasharray="4 4"
          />
          <line
            x1="20"
            y1="155"
            x2="580"
            y2="155"
            stroke="var(--scp-chart-grid)"
          />

          {/* Area Fill */}
          {areaPath && <path d={areaPath} fill="url(#perfChartAreaGradient)" />}

          {/* Line Stroke */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="var(--scp-chart-line)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Data Points */}
          {points.map((pt, idx) => (
            <circle
              key={idx}
              cx={pt.x}
              cy={pt.y}
              r={hoverIndex === idx ? 5 : 2.5}
              fill={hoverIndex === idx ? 'var(--scp-primary)' : 'var(--scp-chart-point)'}
              stroke="var(--scp-bg-surface)"
              strokeWidth="1.5"
            />
          ))}

          {/* Hover Crosshair & Indicator */}
          {hoveredPoint && (
            <g>
              <line
                x1={hoveredPoint.x}
                y1="15"
                x2={hoveredPoint.x}
                y2="155"
                stroke="var(--scp-primary)"
                strokeDasharray="3 3"
                strokeWidth="1.5"
              />
              <circle
                cx={hoveredPoint.x}
                cy={hoveredPoint.y}
                r="6"
                fill="var(--scp-primary)"
                stroke="var(--scp-bg-surface)"
                strokeWidth="2"
              />
            </g>
          )}
        </svg>

        {/* Hover Tooltip Popup */}
        {hoveredPoint && (
          <div
            style={{
              position: 'absolute',
              left: `${(hoveredPoint.x / 600) * 100}%`,
              top: `${(hoveredPoint.y / 180) * 100}%`,
              transform: 'translate(-50%, -120%)',
              backgroundColor: 'var(--scp-chart-tooltip-bg)',
              color: 'var(--scp-chart-tooltip-text)',
              border: '1px solid var(--scp-chart-tooltip-border)',
              borderRadius: '6px',
              padding: '0.3rem 0.6rem',
              fontSize: '0.75rem',
              fontWeight: 600,
              pointerEvents: 'none',
              boxShadow: 'var(--scp-shadow-md)',
              whiteSpace: 'nowrap',
              zIndex: 10,
            }}
          >
            <div>{hoveredPoint.item.time}</div>
            <div style={{ color: 'var(--scp-primary-text)', fontWeight: 700 }}>
              {hoveredPoint.item.value} {activeMetric === 'requests' ? 'req/s' : activeMetric === 'latency' ? 'ms' : activeMetric === 'errors' ? '%' : activeMetric === 'cpu' ? '%' : 'GB'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { PerformanceDataPoint, PerformanceMetricKey, PerformanceTimeRange } from '../../types/console.types';
import type { PerformanceStats } from '../../hooks/useMetricHistory';
import { useLocale } from '../../../../core/i18n/index';

interface PerformanceChartProps {
  activeMetric: PerformanceMetricKey;
  onMetricChange: (metric: PerformanceMetricKey) => void;
  timeRange: PerformanceTimeRange;
  onTimeRangeChange: (range: PerformanceTimeRange) => void;
  series: PerformanceDataPoint[];
  stats: PerformanceStats;
}

const METRICS: PerformanceMetricKey[] = ['requests', 'latency', 'errors', 'cpu', 'memory'];
const RANGES: PerformanceTimeRange[] = ['15m', '1h', '6h', '24h'];
const UNITS: Record<PerformanceMetricKey, string> = { requests: 'req/s', latency: 'ms', errors: '%', cpu: '%', memory: 'GB' };

const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 26, left: 44 };
const Y_TICKS = 4;
const X_LABELS = 5;

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function formatTick(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(value < 1 ? 2 : 1);
}

/** Vùng ④: một biểu đồ lớn, đổi metric/khoảng thời gian — vẽ theo kích thước thật của khung. */
export const PerformanceChart: React.FC<PerformanceChartProps> = ({
  activeMetric,
  onMetricChange,
  timeRange,
  onTimeRangeChange,
  series,
  stats,
}) => {
  const { t } = useLocale();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const chart = useMemo(() => {
    const plotW = Math.max(1, width - PAD.left - PAD.right);
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const max = niceMax(Math.max(0, ...series.map((p) => p.value)) * 1.1);
    const points = series.map((p, i) => ({
      x: PAD.left + (series.length === 1 ? plotW / 2 : (i / (series.length - 1)) * plotW),
      y: PAD.top + plotH - (p.value / max) * plotH,
      point: p,
    }));
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const baseY = PAD.top + plotH;
    const area = points.length > 1 ? `${line} L${points[points.length - 1]!.x},${baseY} L${points[0]!.x},${baseY} Z` : '';
    const yTicks = Array.from({ length: Y_TICKS + 1 }, (_, i) => ({ value: (max / Y_TICKS) * i, y: PAD.top + plotH - (plotH / Y_TICKS) * i }));
    const step = Math.max(1, Math.floor((points.length - 1) / (X_LABELS - 1)));
    const xLabels = points.filter((_, i) => i % step === 0 || i === points.length - 1);
    return { points, line, area, yTicks, xLabels, plotW };
  }, [series, width]);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (chart.points.length === 0) return;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const ratio = (x - PAD.left) / chart.plotW;
    setHover(Math.min(chart.points.length - 1, Math.max(0, Math.round(ratio * (chart.points.length - 1)))));
  };

  const hovered = hover !== null ? chart.points[hover] : undefined;
  const unit = UNITS[activeMetric];

  return (
    <section className="ov-card ov-section ov-chart" aria-labelledby="ov-chart-title">
      <header className="ov-section-head">
        <h3 id="ov-chart-title">{t('ov.chart.title')}</h3>
        <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.range')}>
          {RANGES.map((range) => (
            <button
              key={range}
              type="button"
              role="tab"
              aria-selected={timeRange === range}
              className={timeRange === range ? 'is-active' : ''}
              onClick={() => onTimeRangeChange(range)}
            >
              {t(`chart.range${range}`)}
            </button>
          ))}
        </div>
      </header>

      <div className="ov-segmented ov-chart-metrics" role="tablist" aria-label={t('ov.chart.metric')}>
        {METRICS.map((metric) => (
          <button
            key={metric}
            type="button"
            role="tab"
            aria-selected={activeMetric === metric}
            className={activeMetric === metric ? 'is-active' : ''}
            onClick={() => onMetricChange(metric)}
          >
            {t(`chart.${metric}`)}
          </button>
        ))}
      </div>

      <dl className="ov-chart-stats">
        <div>
          <dt>{t('chart.current')}</dt>
          <dd>{stats.current}</dd>
        </div>
        <div>
          <dt>{t('chart.average')}</dt>
          <dd>{stats.average}</dd>
        </div>
        <div>
          <dt>{t('chart.peak')}</dt>
          <dd>{stats.peak}</dd>
        </div>
      </dl>

      <div ref={wrapRef} className="ov-chart-canvas">
        {series.length === 0 ? (
          <div className="ov-chart-empty">{t('chart.noSamples')}</div>
        ) : (
          <svg width={width} height={HEIGHT} onMouseMove={handleMove} onMouseLeave={() => setHover(null)} role="img" aria-label={t('ov.chart.title')}>
            <defs>
              <linearGradient id="ovChartFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--scp-chart-fill-start)" />
                <stop offset="100%" stopColor="var(--scp-chart-fill-end)" />
              </linearGradient>
            </defs>

            {chart.yTicks.map((tick) => (
              <g key={tick.y}>
                <line x1={PAD.left} x2={width - PAD.right} y1={tick.y} y2={tick.y} className="ov-chart-grid" />
                <text x={PAD.left - 8} y={tick.y + 4} textAnchor="end" className="ov-chart-axis">
                  {formatTick(tick.value)}
                </text>
              </g>
            ))}
            {chart.xLabels.map((p, i) => (
              <text
                key={p.x}
                x={p.x}
                y={HEIGHT - 6}
                textAnchor={i === 0 ? 'start' : i === chart.xLabels.length - 1 ? 'end' : 'middle'}
                className="ov-chart-axis"
              >
                {p.point.time}
              </text>
            ))}

            {chart.area && <path d={chart.area} fill="url(#ovChartFill)" />}
            <path d={chart.line} fill="none" stroke="var(--scp-chart-line)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {chart.points.length <= 60 &&
              chart.points.map((p) => <circle key={p.x} cx={p.x} cy={p.y} r={2.5} fill="var(--scp-chart-point)" />)}

            {hovered && (
              <g>
                <line x1={hovered.x} x2={hovered.x} y1={PAD.top} y2={HEIGHT - PAD.bottom} className="ov-chart-cursor" />
                <circle cx={hovered.x} cy={hovered.y} r={5} fill="var(--scp-primary)" stroke="var(--scp-bg-surface)" strokeWidth={2} />
              </g>
            )}
          </svg>
        )}

        {hovered && (
          <div
            className="ov-chart-tooltip"
            style={{ left: Math.min(Math.max(hovered.x, 60), width - 60), top: hovered.y }}
          >
            <span>{hovered.point.time}</span>
            <strong>
              {hovered.point.value} {unit}
            </strong>
          </div>
        )}
      </div>
    </section>
  );
};

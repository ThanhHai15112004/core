import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface ChartPoint {
  /** epoch ms */
  t: number;
  value: number;
}

export interface ChartSeries {
  id: string;
  label: string;
  /** CSS color, vd. `var(--scp-series-1)` */
  color: string;
  points: ChartPoint[];
}

interface LineChartProps {
  series: ChartSeries[];
  unit: string;
  formatTime: (t: number) => string;
  emptyText: string;
  height?: number;
  ariaLabel: string;
}

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

/** Biểu đồ đường nhiều series, trục thời gian thật; vẽ theo kích thước thật của khung. */
export const LineChart: React.FC<LineChartProps> = ({ series, unit, formatTime, emptyText, height = 220, ariaLabel }) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hoverT, setHoverT] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const visible = series.filter((s) => s.points.length > 0);

  const chart = useMemo(() => {
    const all = visible.flatMap((s) => s.points);
    const minT = Math.min(...all.map((p) => p.t));
    const maxT = Math.max(...all.map((p) => p.t));
    const spanT = Math.max(1, maxT - minT);
    const plotW = Math.max(1, width - PAD.left - PAD.right);
    const plotH = height - PAD.top - PAD.bottom;
    const max = niceMax(Math.max(0, ...all.map((p) => p.value)) * 1.1);
    const x = (t: number) => PAD.left + (all.length === 1 ? plotW / 2 : ((t - minT) / spanT) * plotW);
    const y = (v: number) => PAD.top + plotH - (v / max) * plotH;

    const lines = visible.map((s) => ({
      ...s,
      coords: s.points.map((p) => ({ x: x(p.t), y: y(p.value), p })),
    }));
    const yTicks = Array.from({ length: Y_TICKS + 1 }, (_, i) => ({ value: (max / Y_TICKS) * i, y: PAD.top + plotH - (plotH / Y_TICKS) * i }));
    const xTicks = Array.from({ length: X_LABELS }, (_, i) => minT + (spanT / (X_LABELS - 1)) * i);
    return { lines, yTicks, xTicks, x, minT, maxT, plotW };
  }, [visible, width, height]);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const ratio = Math.min(1, Math.max(0, (px - PAD.left) / chart.plotW));
    setHoverT(chart.minT + ratio * (chart.maxT - chart.minT));
  };

  /* Với mỗi series, điểm gần thời điểm hover nhất. */
  const hovered =
    hoverT === null
      ? []
      : chart.lines.map((line) => {
          const nearest = line.coords.reduce((best, c) => (Math.abs(c.p.t - hoverT) < Math.abs(best.p.t - hoverT) ? c : best));
          return { line, point: nearest };
        });
  const hoverX = hovered[0]?.point.x;

  return (
    <div ref={wrapRef} className="lc-canvas" style={{ minHeight: height }}>
      {visible.length === 0 ? (
        <div className="lc-empty" style={{ height }}>
          {emptyText}
        </div>
      ) : (
        <>
          <svg width={width} height={height} onMouseMove={handleMove} onMouseLeave={() => setHoverT(null)} role="img" aria-label={ariaLabel}>
            {chart.yTicks.map((tick) => (
              <g key={tick.y}>
                <line x1={PAD.left} x2={width - PAD.right} y1={tick.y} y2={tick.y} className="lc-grid" />
                <text x={PAD.left - 8} y={tick.y + 4} textAnchor="end" className="lc-axis">
                  {formatTick(tick.value)}
                </text>
              </g>
            ))}
            {chart.xTicks.map((t, i) => (
              <text
                key={t}
                x={chart.x(t)}
                y={height - 6}
                textAnchor={i === 0 ? 'start' : i === chart.xTicks.length - 1 ? 'end' : 'middle'}
                className="lc-axis"
              >
                {formatTime(t)}
              </text>
            ))}

            {chart.lines.map((line) => (
              <g key={line.id}>
                <path
                  d={line.coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')}
                  fill="none"
                  stroke={line.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {line.coords.length <= 60 && line.coords.map((c) => <circle key={c.p.t} cx={c.x} cy={c.y} r={2.2} fill={line.color} />)}
              </g>
            ))}

            {hoverX !== undefined && (
              <g>
                <line x1={hoverX} x2={hoverX} y1={PAD.top} y2={height - PAD.bottom} className="lc-cursor" />
                {hovered.map(({ line, point }) => (
                  <circle key={line.id} cx={point.x} cy={point.y} r={4.5} fill={line.color} stroke="var(--scp-bg-surface)" strokeWidth={2} />
                ))}
              </g>
            )}
          </svg>

          {hoverX !== undefined && hovered[0] && (
            <div className="lc-tooltip" style={{ left: Math.min(Math.max(hoverX, 70), width - 70), top: PAD.top }}>
              <span>{formatTime(hovered[0].point.p.t)}</span>
              {hovered.map(({ line, point }) => (
                <span key={line.id} className="lc-tooltip-row">
                  <i style={{ background: line.color }} />
                  {line.label}: <strong>{point.p.value} {unit}</strong>
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {visible.length > 1 && (
        <ul className="lc-legend">
          {visible.map((s) => (
            <li key={s.id}>
              <i style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

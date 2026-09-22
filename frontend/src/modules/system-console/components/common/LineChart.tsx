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
  /** Series vẽ theo trục phải (đơn vị khác, vd. so sánh CPU với latency). */
  axis?: 'left' | 'right';
  dashed?: boolean;
  /** Đơn vị riêng trong tooltip (mặc định `unit` của biểu đồ). */
  unit?: string;
}

/** Mốc sự kiện trên trục thời gian (restart, bắt đầu nghẽn…). */
export interface ChartMarker {
  t: number;
  label: string;
  color: string;
}

interface LineChartProps {
  series: ChartSeries[];
  unit: string;
  formatTime: (t: number) => string;
  emptyText: string;
  height?: number;
  ariaLabel: string;
  markers?: ChartMarker[];
}

const PAD = { top: 12, right: 12, bottom: 26, left: 44 };
const RIGHT_AXIS_PAD = 48;
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
export const LineChart: React.FC<LineChartProps> = ({ series, unit, formatTime, emptyText, height = 220, ariaLabel, markers = [] }) => {
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
    const hasRight = visible.some((s) => s.axis === 'right');
    const padRight = hasRight ? RIGHT_AXIS_PAD : PAD.right;
    const plotW = Math.max(1, width - PAD.left - padRight);
    const plotH = height - PAD.top - PAD.bottom;
    const maxOf = (axis: 'left' | 'right') =>
      niceMax(Math.max(0, ...visible.filter((s) => (s.axis ?? 'left') === axis).flatMap((s) => s.points.map((p) => p.value))) * 1.1);
    const max = maxOf('left');
    const maxRight = maxOf('right');
    const x = (t: number) => PAD.left + (all.length === 1 ? plotW / 2 : ((t - minT) / spanT) * plotW);
    const yFor = (axisMax: number) => (v: number) => PAD.top + plotH - (v / axisMax) * plotH;

    const lines = visible.map((s) => {
      const y = yFor(s.axis === 'right' ? maxRight : max);
      return { ...s, coords: s.points.map((p) => ({ x: x(p.t), y: y(p.value), p })) };
    });
    const ticksOf = (axisMax: number) =>
      Array.from({ length: Y_TICKS + 1 }, (_, i) => ({ value: (axisMax / Y_TICKS) * i, y: PAD.top + plotH - (plotH / Y_TICKS) * i }));
    const yTicks = ticksOf(max);
    const rightTicks = hasRight ? ticksOf(maxRight) : [];
    // Màn hẹp: ít nhãn thời gian hơn để không chồng chữ.
    const xLabels = width < 480 ? 3 : X_LABELS;
    const xTicks = Array.from({ length: xLabels }, (_, i) => minT + (spanT / (xLabels - 1)) * i);
    const marks = markers.filter((m) => m.t >= minT && m.t <= maxT).map((m) => ({ ...m, x: x(m.t) }));
    return { lines, yTicks, rightTicks, xTicks, x, minT, maxT, plotW, padRight, marks };
  }, [visible, width, height, markers]);

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
                <line x1={PAD.left} x2={width - chart.padRight} y1={tick.y} y2={tick.y} className="lc-grid" />
                <text x={PAD.left - 8} y={tick.y + 4} textAnchor="end" className="lc-axis">
                  {formatTick(tick.value)}
                </text>
              </g>
            ))}
            {chart.rightTicks.map((tick) => (
              <text key={`r${tick.y}`} x={width - chart.padRight + 8} y={tick.y + 4} textAnchor="start" className="lc-axis">
                {formatTick(tick.value)}
              </text>
            ))}
            {chart.marks.map((m) => (
              <g key={`${m.t}-${m.label}`} className="lc-marker">
                <title>{`${formatTime(m.t)} — ${m.label}`}</title>
                <line x1={m.x} x2={m.x} y1={PAD.top} y2={height - PAD.bottom} stroke={m.color} strokeDasharray="3 3" strokeWidth={1.5} />
                <path d={`M${m.x - 5},${PAD.top - 2} L${m.x + 5},${PAD.top - 2} L${m.x},${PAD.top + 5} Z`} fill={m.color} />
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
                  strokeWidth={line.dashed ? 1.5 : 2}
                  strokeDasharray={line.dashed ? '5 4' : undefined}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {!line.dashed && line.coords.length <= 60 && line.coords.map((c) => <circle key={c.p.t} cx={c.x} cy={c.y} r={2.2} fill={line.color} />)}
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
                  {line.label}: <strong>{point.p.value} {line.unit ?? unit}</strong>
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {visible.length > 1 && (
        <ul className="lc-legend">
          {visible.map((s) => (
            <li key={s.id} className={s.dashed ? 'is-dashed' : undefined}>
              <i style={{ background: s.color }} />
              {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

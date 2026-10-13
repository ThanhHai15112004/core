import React, { useEffect, useRef, useState } from 'react';
import type { LogsSeries, LogsSeriesPoint } from '../../types/logs.types';
import { useLocale } from '../../../../core/i18n/index';

export type VolumeMode = 'all' | 'errors' | 'warnings';

const LAYERS: { key: keyof Omit<LogsSeriesPoint, 't'>; color: string }[] = [
  { key: 'debug', color: 'var(--scp-border-strong)' },
  { key: 'info', color: 'var(--scp-info)' },
  { key: 'warn', color: 'var(--scp-warning)' },
  { key: 'error', color: 'var(--scp-danger)' },
  { key: 'fatal', color: 'var(--scp-danger-text)' },
];
const MODE_LAYERS: Record<VolumeMode, (keyof Omit<LogsSeriesPoint, 't'>)[]> = {
  all: ['debug', 'info', 'warn', 'error', 'fatal'],
  errors: ['error', 'fatal'],
  warnings: ['warn'],
};
const PAD = { top: 10, right: 8, bottom: 22, left: 40 };

/** Log theo thời gian, xếp chồng theo level (DEBUG / INFO / WARN / ERROR / FATAL); đánh dấu spike lỗi. */
export const LogVolumeChart: React.FC<{ data: LogsSeries | null; mode: VolumeMode; height?: number; onPick?: (t: string) => void }> = ({
  data,
  mode,
  height = 200,
  onPick,
}) => {
  const { t, formatTime } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const points = data?.points ?? [];
  const layers = LAYERS.filter((l) => MODE_LAYERS[mode].includes(l.key));
  const totals = points.map((p) => layers.reduce((a, l) => a + p[l.key], 0));
  const max = Math.max(1, ...totals);
  const niceMax = (() => {
    const m = 10 ** Math.floor(Math.log10(max));
    return Math.ceil(max / m) * m;
  })();
  const innerW = width - PAD.left - PAD.right;
  const innerH = height - PAD.top - PAD.bottom;
  const bw = points.length ? innerW / points.length : innerW;
  const y = (v: number) => PAD.top + innerH - (v / niceMax) * innerH;
  const spikeIdx = data?.spike ? points.findIndex((p) => p.t === data.spike!.at) : -1;
  const empty = !points.length || totals.every((v) => v === 0);

  return (
    <div ref={ref} className="lg-chart" onMouseLeave={() => setHover(null)}>
      {empty ? (
        <p className="ov-empty-line" style={{ height, display: 'grid', placeItems: 'center' }}>
          {t('logs.chart.empty')}
        </p>
      ) : (
        <svg width={width} height={height} role="img" aria-label={t('logs.chart.title')}>
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(niceMax * f)} y2={y(niceMax * f)} stroke="var(--scp-chart-grid)" />
              <text x={PAD.left - 6} y={y(niceMax * f) + 4} textAnchor="end" className="lg-axis">
                {Math.round(niceMax * f)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            let acc = 0;
            const x = PAD.left + i * bw;
            return (
              <g key={p.t} onMouseEnter={() => setHover(i)} onClick={() => onPick?.(p.t)} style={{ cursor: onPick ? 'pointer' : 'default' }}>
                <rect x={x} y={PAD.top} width={bw} height={innerH} fill="transparent" />
                {layers.map((l) => {
                  const v = p[l.key];
                  if (!v) return null;
                  const y0 = y(acc);
                  acc += v;
                  return <rect key={l.key} x={x + bw * 0.1} width={Math.max(1, bw * 0.8)} y={y(acc)} height={Math.max(0.5, y0 - y(acc))} fill={l.color} />;
                })}
                {i === spikeIdx && (
                  <text x={x + bw / 2} y={PAD.top + 8} textAnchor="middle" className="lg-spike-mark">
                    ▲
                  </text>
                )}
              </g>
            );
          })}
          {[0, Math.floor(points.length / 2), points.length - 1].map((i) =>
            points[i] ? (
              <text key={i} x={PAD.left + i * bw + bw / 2} y={height - 6} textAnchor="middle" className="lg-axis">
                {formatTime(points[i].t)}
              </text>
            ) : null,
          )}
        </svg>
      )}
      {hover !== null && points[hover] && (
        <div className="lg-chart-tip" style={{ left: Math.min(width - 160, PAD.left + hover * bw) }}>
          <strong>{formatTime(points[hover].t, true)}</strong>
          {layers.map((l) => (
            <span key={l.key}>
              <i style={{ background: l.color }} /> {l.key.toUpperCase()} {points[hover]![l.key]}
            </span>
          ))}
        </div>
      )}
      <div className="lg-legend">
        {layers.map((l) => (
          <span key={l.key}>
            <i style={{ background: l.color }} /> {l.key.toUpperCase()}
          </span>
        ))}
      </div>
    </div>
  );
};

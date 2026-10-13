import { useMemo } from 'react';
import { cn } from '../../lib/cn';
import { TONE_CLASS, type Tone } from '../../theme/tone';
import { SPARKLINE_HEIGHT_PX } from '../../constants/ui.constants';

interface SparklineProps {
  values: (number | null)[];
  tone?: Tone;
  height?: number;
  className?: string;
}

const VIEW_W = 100;

/** Đường xu hướng nhỏ (SVG thuần, nhẹ — dùng trong ô số liệu / hàng bảng). Null = đứt đoạn. */
export function Sparkline({ values, tone, height = SPARKLINE_HEIGHT_PX, className }: SparklineProps) {
  const paths = useMemo(() => {
    const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
    if (nums.length < 2) return [];
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const span = max - min || 1;
    const step = VIEW_W / Math.max(1, values.length - 1);
    const segments: string[] = [];
    let current = '';
    values.forEach((v, i) => {
      if (v === null || !Number.isFinite(v)) {
        if (current) segments.push(current);
        current = '';
        return;
      }
      const x = (i * step).toFixed(2);
      const y = (height - 2 - ((v - min) / span) * (height - 4)).toFixed(2);
      current += `${current ? 'L' : 'M'}${x},${y}`;
    });
    if (current) segments.push(current);
    return segments;
  }, [values, height]);

  if (paths.length === 0) return null;
  const color = tone && tone !== 'unknown' ? TONE_CLASS[tone].text : 'text-series-6';
  return (
    <svg viewBox={`0 0 ${VIEW_W} ${height}`} preserveAspectRatio="none" className={cn('block', color, className)} style={{ height }} aria-hidden="true">
      {paths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

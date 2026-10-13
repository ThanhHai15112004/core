import { cn } from '../../lib/cn';
import { TONE_CLASS, type Tone } from '../../theme/tone';
import { formatPercent } from '../../lib/format';

interface UsageBarProps {
  /** Phần trăm 0–100; null = không có dữ liệu. */
  percent: number | null;
  /** Ngưỡng đổi màu; bỏ trống = theo `tone`. */
  thresholds?: { warn: number; crit: number };
  tone?: Tone;
  label?: string;
  showValue?: boolean;
  className?: string;
}

/** Thanh mức dùng (CPU, RAM, dung lượng, pool…). */
export function UsageBar({ percent, thresholds, tone, label, showValue = true, className }: UsageBarProps) {
  const p = percent === null ? null : Math.max(0, Math.min(100, percent));
  const resolved: Tone = tone ?? (p === null || !thresholds ? 'info' : p >= thresholds.crit ? 'crit' : p >= thresholds.warn ? 'warn' : 'ok');
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      {label && <span className="w-20 shrink-0 truncate text-xs text-muted">{label}</span>}
      <div className="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-panel-3" role="meter" aria-valuenow={p ?? undefined} aria-valuemin={0} aria-valuemax={100}>
        {p !== null && <div className={cn('h-full rounded-full', TONE_CLASS[resolved].bg)} style={{ width: `${p}%` }} />}
      </div>
      {showValue && <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-fg-2">{formatPercent(percent)}</span>}
    </div>
  );
}

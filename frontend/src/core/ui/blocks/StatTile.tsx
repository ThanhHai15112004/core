import React from 'react';
import { ArrowDownRight, ArrowUpRight, Info } from 'lucide-react';
import { cn } from '../../lib/cn';
import { TONE_CLASS, type Tone } from '../../theme/tone';
import { Hint } from '../primitives/tooltip';
import { Skeleton } from '../primitives/skeleton';
import { Sparkline } from '../charts/Sparkline';

export interface StatDelta {
  /** Đã định dạng, vd. "+12.3%". */
  text: string;
  direction: 'up' | 'down' | 'flat';
  /** Thay đổi này tốt hay xấu (quyết định màu). */
  good: boolean | null;
}

export interface StatTileProps {
  label: string;
  /** Giá trị đã định dạng (null-safe: truyền `NO_VALUE` khi không có). */
  value: React.ReactNode;
  unit?: string;
  /** Dòng phụ dưới giá trị. */
  sub?: React.ReactNode;
  tone?: Tone;
  delta?: StatDelta | null;
  /** Chuỗi giá trị gần đây — vẽ sparkline. */
  trend?: (number | null)[] | null;
  /** Nguồn / công thức / cửa sổ thời gian — hiện ở tooltip ⓘ. */
  hint?: React.ReactNode;
  onClick?: () => void;
  loading?: boolean;
  /** Ô hẹp: cho đơn vị / thay đổi xuống dòng thay vì cắt số (mặc định: một dòng, cắt số). */
  wrap?: boolean;
  className?: string;
}

const DELTA_CLASS = (good: boolean | null) => (good === null ? 'text-muted' : good ? 'text-ok-fg' : 'text-crit-fg');

/** Ô số liệu: nhãn, giá trị lớn, đơn vị, thay đổi so với kỳ trước, sparkline. */
export function StatTile({ label, value, unit, sub, tone, delta, trend, hint, onClick, loading, wrap, className }: StatTileProps) {
  const interactive = Boolean(onClick);
  const Comp = interactive ? 'button' : 'div';
  return (
    <Comp
      type={interactive ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'relative flex min-w-0 flex-col gap-1 overflow-hidden rounded-lg border border-border bg-panel p-3 text-left',
        interactive && 'transition-colors hover:border-border-strong hover:bg-panel-2',
        className,
      )}
    >
      {tone && tone !== 'unknown' && tone !== 'ok' && <span className={cn('absolute inset-y-0 left-0 w-0.5', TONE_CLASS[tone].bg)} aria-hidden="true" />}
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
        <span className="truncate">{label}</span>
        {hint && (
          <Hint content={hint}>
            <span className="inline-flex text-faint hover:text-muted" onClick={(e) => e.stopPropagation()}>
              <Info className="size-3.5" />
            </span>
          </Hint>
        )}
      </div>
      {loading ? (
        <>
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-3.5 w-32" />
        </>
      ) : (
        <>
          <div className={cn('flex items-baseline gap-1.5', wrap && 'flex-wrap gap-y-0.5')}>
            <span
              className={cn(
                'font-mono text-xl font-semibold tabular-nums',
                wrap ? 'shrink-0' : 'truncate',
                tone === 'warn' || tone === 'crit' ? TONE_CLASS[tone].fg : 'text-fg',
              )}
            >
              {value}
            </span>
            {unit && <span className="text-sm text-muted">{unit}</span>}
            {delta && (
              <span className={cn('ml-auto inline-flex items-center gap-0.5 font-mono text-xs', wrap && 'whitespace-nowrap', DELTA_CLASS(delta.good))}>
                {delta.direction === 'up' ? <ArrowUpRight className="size-3.5" /> : delta.direction === 'down' ? <ArrowDownRight className="size-3.5" /> : null}
                {delta.text}
              </span>
            )}
          </div>
          <div className="flex min-h-4 items-end justify-between gap-2">
            {sub ? <div className="min-w-0 truncate text-xs text-faint">{sub}</div> : <span />}
            {trend && trend.length > 1 && <Sparkline values={trend} tone={tone} className="w-20 shrink-0" />}
          </div>
        </>
      )}
    </Comp>
  );
}

const COLS = {
  2: 'grid-cols-2',
  3: 'grid-cols-2 md:grid-cols-3',
  4: 'grid-cols-2 lg:grid-cols-4',
  5: 'grid-cols-2 md:grid-cols-3 xl:grid-cols-5',
  6: 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6',
} as const;

export function StatGrid({ columns = 4, className, children }: { columns?: keyof typeof COLS; className?: string; children: React.ReactNode }) {
  return <div className={cn('mb-4 grid gap-3', COLS[columns], className)}>{children}</div>;
}

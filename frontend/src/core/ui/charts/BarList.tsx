import React from 'react';
import { cn } from '../../lib/cn';
import { TONE_CLASS, type Tone } from '../../theme/tone';

export interface BarListItem {
  id: string;
  label: React.ReactNode;
  /** Giá trị dùng để tính độ dài thanh. */
  value: number | null;
  /** Giá trị đã định dạng hiển thị bên phải. */
  display: string;
  sub?: React.ReactNode;
  tone?: Tone;
  onClick?: () => void;
}

/** Top-N dạng thanh ngang (endpoint chậm nhất, namespace lớn nhất…). HTML thuần, bấm được. */
export function BarList({ items, className }: { items: BarListItem[]; className?: string }) {
  const max = Math.max(0, ...items.map((i) => i.value ?? 0)) || 1;
  return (
    <ul className={cn('flex flex-col gap-1', className)}>
      {items.map((item) => {
        const pct = item.value === null ? 0 : Math.max(1, (item.value / max) * 100);
        const body = (
          <>
            <span className={cn('absolute inset-y-0 left-0 rounded-sm opacity-20', item.tone ? TONE_CLASS[item.tone].bg : 'bg-series-6')} style={{ width: `${pct}%` }} aria-hidden="true" />
            <span className="relative min-w-0 flex-1 truncate text-left text-sm text-fg-2">{item.label}</span>
            {item.sub && <span className="relative shrink-0 text-xs text-faint">{item.sub}</span>}
            <span className="relative shrink-0 font-mono text-xs tabular-nums text-fg">{item.display}</span>
          </>
        );
        return (
          <li key={item.id}>
            {item.onClick ? (
              <button type="button" onClick={item.onClick} className="relative flex h-7 w-full items-center gap-2 rounded-sm px-2 hover:bg-panel-2">
                {body}
              </button>
            ) : (
              <div className="relative flex h-7 items-center gap-2 px-2">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';
import { TONE_CLASS, type Tone } from '../../theme/tone';
import { Hint } from '../primitives/tooltip';
import { StatusDot } from './StatusDot';

export interface HealthGridItem {
  id: string;
  label: string;
  icon?: LucideIcon;
  tone: Tone;
  /** Một số chính (đã định dạng). */
  value?: React.ReactNode;
  /** Giải thích thêm — tooltip. */
  detail?: string | null;
  onClick?: () => void;
}

export interface HealthGridGroup {
  id: string;
  label?: string;
  items: HealthGridItem[];
}

/** Bảng trạng thái: mỗi thành phần một ô (chấm trạng thái + tên + một số), nhóm theo loại, bấm để xem chi tiết. */
export function HealthGrid({ groups, className }: { groups: HealthGridGroup[]; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <div key={g.id}>
            {g.label && <div className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-faint">{g.label}</div>}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((item) => (
                <HealthTile key={item.id} item={item} />
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}

function HealthTile({ item }: { item: HealthGridItem }) {
  const Icon = item.icon;
  const alert = item.tone === 'warn' || item.tone === 'crit';
  const body = (
    <button
      type="button"
      onClick={item.onClick}
      disabled={!item.onClick}
      className={cn(
        'flex w-full min-w-0 flex-col gap-0.5 rounded-md border px-3 py-2 text-left transition-colors',
        alert ? TONE_CLASS[item.tone].soft : 'border-border bg-panel-2 hover:border-border-strong',
      )}
    >
      <span className="flex w-full min-w-0 items-center gap-2">
        {Icon && <Icon className="size-4 shrink-0 text-muted" />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-fg">{item.label}</span>
        <StatusDot tone={item.tone} size="sm" />
      </span>
      {item.value !== undefined && item.value !== null && (
        <span className={cn('w-full truncate font-mono text-xs tabular-nums', alert ? TONE_CLASS[item.tone].fg : 'text-fg-2', Icon && 'pl-6')}>{item.value}</span>
      )}
    </button>
  );
  return item.detail ? <Hint content={item.detail}>{body}</Hint> : body;
}

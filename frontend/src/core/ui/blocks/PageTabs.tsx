import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Tabs, TabsList, TabsTrigger } from '../primitives/tabs';

export interface PageTab<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
  /** Số đếm nhỏ (vd. số lỗi) — 0/undefined thì ẩn. */
  count?: number | null;
  countTone?: 'crit' | 'warn' | 'neutral';
}

interface PageTabsProps<T extends string> {
  tabs: PageTab<T>[];
  value: T;
  onChange: (tab: T) => void;
  /** Nội dung bên phải thanh tab (filter nhanh…). */
  trailing?: React.ReactNode;
  className?: string;
}

const COUNT_TONE = {
  crit: 'bg-crit-bg text-crit-fg',
  warn: 'bg-warn-bg text-warn-fg',
  neutral: 'bg-panel-3 text-fg-2',
} as const;

/** Thanh tab của một trang; nội dung tab do route quyết định (không giữ state riêng). */
export function PageTabs<T extends string>({ tabs, value, onChange, trailing, className }: PageTabsProps<T>) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as T)} className={cn('mb-4 flex items-end gap-3 border-b border-border', className)}>
      <TabsList className="min-w-0 flex-1 border-b-0">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <TabsTrigger key={tab.id} value={tab.id}>
              {Icon && <Icon />}
              {tab.label}
              {tab.count ? (
                <span className={cn('rounded-sm px-1.5 font-mono text-2xs', COUNT_TONE[tab.countTone ?? 'neutral'])}>{tab.count}</span>
              ) : null}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {trailing && <div className="flex shrink-0 items-center gap-2 pb-1.5">{trailing}</div>}
    </Tabs>
  );
}

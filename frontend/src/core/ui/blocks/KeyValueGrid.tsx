import React from 'react';
import { cn } from '../../lib/cn';
import { NO_VALUE } from '../../lib/format';
import { Hint } from '../primitives/tooltip';

export interface KeyValueItem {
  key?: string;
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  hint?: React.ReactNode;
}

const COLS = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' } as const;

/** Lưới nhãn / giá trị (thông tin chi tiết, cấu hình). Giá trị rỗng → "—". */
export function KeyValueGrid({ items, columns = 2, className }: { items: KeyValueItem[]; columns?: keyof typeof COLS; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-2.5', COLS[columns], className)}>
      {items.map((item, i) => {
        const empty = item.value === null || item.value === undefined || item.value === '';
        return (
          <div key={item.key ?? item.label ?? i} className="min-w-0">
            <dt className="truncate text-xs text-muted">
              {item.hint ? (
                <Hint content={item.hint}>
                  <span className="cursor-help underline decoration-dotted underline-offset-2">{item.label}</span>
                </Hint>
              ) : (
                item.label
              )}
            </dt>
            <dd className={cn('mt-0.5 break-words text-sm text-fg', item.mono && 'font-mono text-xs', empty && 'text-faint')}>{empty ? NO_VALUE : item.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

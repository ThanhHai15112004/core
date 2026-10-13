import React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface Crumb {
  label: React.ReactNode;
  onClick?: () => void;
}

/** Breadcrumb; mục cuối là trang hiện tại. Trên màn hẹp chỉ giữ 2 mục cuối. */
export function Breadcrumb({ items, ariaLabel }: { items: Crumb[]; ariaLabel: string }) {
  return (
    <nav aria-label={ariaLabel} className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          const hideOnMobile = i < items.length - 2;
          return (
            <li key={i} className={cn('flex min-w-0 items-center gap-1', hideOnMobile && 'hidden sm:flex')}>
              {i > 0 && <ChevronRight className={cn('size-3.5 shrink-0 text-faint', i <= items.length - 2 && 'hidden sm:block')} aria-hidden="true" />}
              {last ? (
                <span className="truncate font-medium text-fg" aria-current="page">
                  {c.label}
                </span>
              ) : c.onClick ? (
                <button type="button" onClick={c.onClick} className="truncate text-muted hover:text-fg">
                  {c.label}
                </button>
              ) : (
                <span className="truncate text-muted">{c.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

import React, { useState } from 'react';
import { Info, Maximize2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useLocale } from '../../i18n/index';
import { Button } from '../primitives/button';
import { Hint } from '../primitives/tooltip';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '../primitives/dialog';

export interface PanelProps {
  title?: React.ReactNode;
  /** Giải thích ngắn: nguồn dữ liệu, công thức… (tooltip ⓘ). */
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  /** Cho phép phóng to nội dung (biểu đồ, bảng dài). */
  expandable?: boolean;
  /** Bỏ padding thân panel (bảng tràn sát mép). */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}

/** Khung chứa chuẩn: tiêu đề + ⓘ + hành động + thân. */
export function Panel({ title, hint, actions, expandable, flush, className, bodyClassName, children }: PanelProps) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const hasHead = title || actions || expandable;
  return (
    <section className={cn('flex min-w-0 flex-col rounded-lg border border-border bg-panel', className)}>
      {hasHead && (
        <header className="flex min-h-10 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {title && <h2 className="truncate text-sm font-semibold text-fg">{title}</h2>}
              {hint && (
                <Hint content={hint}>
                  <span className="inline-flex text-faint hover:text-muted">
                    <Info className="size-3.5" />
                  </span>
                </Hint>
              )}
            </div>
          </div>
          {actions && <div className="flex max-w-full shrink-0 items-center gap-1.5">{actions}</div>}
          {expandable && (
            <Hint content={t('ui.action.fullscreen')}>
              <Button variant="ghost" size="icon-xs" onClick={() => setExpanded(true)} aria-label={t('ui.action.fullscreen')}>
                <Maximize2 />
              </Button>
            </Hint>
          )}
        </header>
      )}
      <div className={cn('min-w-0 flex-1', !flush && 'p-3', bodyClassName)}>{children}</div>
      {expandable && (
        <Dialog open={expanded} onOpenChange={setExpanded}>
          <DialogContent className="max-h-[92vh] max-w-[min(1400px,calc(100%-2rem))]" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>{title}</DialogTitle>
            </DialogHeader>
            <DialogBody>{children}</DialogBody>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

const GRID = {
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  '2-1': 'lg:grid-cols-[2fr_1fr]',
  '1-2': 'lg:grid-cols-[1fr_2fr]',
} as const;

/** Lưới panel: 1 cột trên mobile, chia cột từ màn lớn. */
export function PanelGrid({ layout = 2, className, children }: { layout?: keyof typeof GRID; className?: string; children: React.ReactNode }) {
  return <div className={cn('mb-4 grid grid-cols-1 gap-4', GRID[layout], className)}>{children}</div>;
}

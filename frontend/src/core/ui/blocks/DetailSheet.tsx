import React, { useState } from 'react';
import { Info } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { Tone } from '../../theme/tone';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../primitives/sheet';
import { Badge } from '../primitives/badge';
import { Hint } from '../primitives/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../primitives/tabs';
import { StatusDot } from './StatusDot';

export interface DetailTab {
  id: string;
  label: string;
  content: React.ReactNode;
}

interface DetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  status?: { tone: Tone; label: string };
  actions?: React.ReactNode;
  /** Có tabs → hiện thanh tab; không thì render `children`. */
  tabs?: DetailTab[];
  width?: 'sm' | 'md' | 'lg' | 'xl';
  children?: React.ReactNode;
}

/** Drawer chi tiết bên phải (Esc để đóng) — dùng cho mọi "xem chi tiết một dòng". */
export function DetailSheet({ open, onOpenChange, title, subtitle, status, actions, tabs, width = 'md', children }: DetailSheetProps) {
  const [tab, setTab] = useState<string | undefined>(undefined);
  const active = tab && tabs?.some((t) => t.id === tab) ? tab : tabs?.[0]?.id;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent width={width} aria-describedby={subtitle ? undefined : undefined}>
        <div className="flex shrink-0 flex-col gap-1 border-b border-border px-5 py-4 pr-12">
          <div className="flex min-w-0 items-center gap-2">
            <SheetTitle className="min-w-0 truncate text-md font-semibold text-fg">{title}</SheetTitle>
            {status && (
              <Badge tone={status.tone}>
                <StatusDot tone={status.tone} size="xs" />
                {status.label}
              </Badge>
            )}
          </div>
          {subtitle ? <SheetDescription className="truncate text-xs text-muted">{subtitle}</SheetDescription> : <SheetDescription className="sr-only">{title}</SheetDescription>}
          {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
        </div>
        {tabs ? (
          <Tabs value={active} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="shrink-0 px-3">
              {tabs.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            {tabs.map((t) => (
              <TabsContent key={t.id} value={t.id} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {t.content}
              </TabsContent>
            ))}
          </Tabs>
        ) : (
          <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4')}>{children}</div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Nhóm nội dung trong drawer: tiêu đề nhỏ (+ ⓘ giải thích) + thân. */
export function DetailSection({
  title,
  hint,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  /** Giải thích ngắn (nguồn, công thức) — tooltip ⓘ cạnh tiêu đề. */
  hint?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('mb-5 last:mb-0', className)}>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="flex flex-1 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
          {title}
          {hint && (
            <Hint content={hint}>
              <span className="inline-flex text-faint normal-case hover:text-muted">
                <Info className="size-3.5" />
              </span>
            </Hint>
          )}
        </h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

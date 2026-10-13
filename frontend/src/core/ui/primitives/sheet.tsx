import React from 'react';
import { Dialog as SheetPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useLocale } from '../../i18n/index';

export const Sheet = SheetPrimitive.Root;
export const SheetTrigger = SheetPrimitive.Trigger;
export const SheetClose = SheetPrimitive.Close;
export const SheetTitle = SheetPrimitive.Title;
export const SheetDescription = SheetPrimitive.Description;

const SIDE = {
  right: 'inset-y-0 right-0 h-full border-l',
  left: 'inset-y-0 left-0 h-full border-r',
} as const;

const WIDTH = {
  sm: 'w-full sm:max-w-sm',
  md: 'w-full sm:max-w-xl',
  lg: 'w-full sm:max-w-3xl',
  xl: 'w-full sm:max-w-5xl',
} as const;

export interface SheetContentProps extends React.ComponentProps<typeof SheetPrimitive.Content> {
  side?: keyof typeof SIDE;
  width?: keyof typeof WIDTH;
  hideClose?: boolean;
}

export function SheetContent({ className, children, side = 'right', width = 'md', hideClose, ...props }: SheetContentProps) {
  const { t } = useLocale();
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay" />
      <SheetPrimitive.Content
        className={cn('fixed z-50 flex flex-col border-border-strong bg-panel text-fg shadow-lg outline-none', SIDE[side], WIDTH[width], className)}
        // Focus vào khung drawer thay vì nút đóng (tránh viền focus nổi lên ngay khi mở).
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
        {...props}
      >
        {children}
        {!hideClose && (
          <SheetPrimitive.Close className="absolute right-3 top-3 rounded-sm p-1 text-muted hover:bg-panel-2 hover:text-fg" aria-label={t('ui.action.close')}>
            <X className="size-4" />
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

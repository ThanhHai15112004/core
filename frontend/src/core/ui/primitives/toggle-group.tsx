import React from 'react';
import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui';
import { cn } from '../../lib/cn';

/** Nhóm nút chọn một (segmented control). */
export function ToggleGroup({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      className={cn('inline-flex items-center rounded-md border border-border-strong bg-bg p-0.5', className)}
      {...props}
    />
  );
}

export function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        'inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-sm px-2 text-xs font-medium text-muted transition-colors hover:text-fg data-[state=on]:bg-panel-3 data-[state=on]:text-fg disabled:opacity-40 [&_svg]:size-3.5',
        className,
      )}
      {...props}
    />
  );
}

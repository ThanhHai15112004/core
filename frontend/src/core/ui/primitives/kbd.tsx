import React from 'react';
import { cn } from '../../lib/cn';

export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn('inline-flex h-5 items-center rounded-sm border border-border-strong bg-panel-2 px-1.5 font-mono text-2xs text-muted', className)}
      {...props}
    />
  );
}

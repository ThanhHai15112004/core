import React from 'react';
import { cn } from '../../lib/cn';

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-shimmer rounded-sm bg-[linear-gradient(90deg,var(--ui-skeleton)_25%,var(--ui-skeleton-shine)_50%,var(--ui-skeleton)_75%)] bg-[length:200%_100%]',
        className,
      )}
      {...props}
    />
  );
}

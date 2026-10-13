import React from 'react';
import { Slot } from 'radix-ui';
import type { VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';
import { buttonVariants } from './button-variants';

export type ButtonProps = React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  return <Comp type={asChild ? undefined : (type ?? 'button')} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

import React from 'react';
import { cn } from '../../lib/cn';

export const inputClass =
  'h-8 w-full min-w-0 rounded-md border border-border-strong bg-bg px-2.5 text-sm text-fg placeholder:text-faint focus-visible:border-focus focus-visible:outline-none disabled:opacity-50';

export function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return <input type={type} className={cn(inputClass, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(inputClass, 'h-auto min-h-20 py-2', className)} {...props} />;
}

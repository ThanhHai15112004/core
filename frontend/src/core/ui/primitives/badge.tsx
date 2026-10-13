import React from 'react';
import { cn } from '../../lib/cn';
import { TONE_CLASS, type Tone } from '../../theme/tone';

export interface BadgeProps extends React.ComponentProps<'span'> {
  /** Tông màu; bỏ trống = trung tính. */
  tone?: Tone;
  variant?: 'soft' | 'outline' | 'solid';
  size?: 'xs' | 'sm';
}

const SIZE = { xs: 'h-4 px-1.5 text-2xs', sm: 'h-5 px-2 text-xs' } as const;

export function Badge({ tone, variant = 'soft', size = 'sm', className, ...props }: BadgeProps) {
  const toneClass = tone
    ? variant === 'solid'
      ? cn(TONE_CLASS[tone].bg, 'text-inverse border-transparent')
      : variant === 'outline'
        ? cn(TONE_CLASS[tone].border, TONE_CLASS[tone].fg)
        : TONE_CLASS[tone].soft
    : variant === 'solid'
      ? 'bg-panel-3 text-fg border-transparent'
      : 'border-border-strong bg-panel-2 text-fg-2';
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-sm border font-medium [&_svg]:size-3', SIZE[size], toneClass, className)}
      {...props}
    />
  );
}

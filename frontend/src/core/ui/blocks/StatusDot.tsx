import React from 'react';
import { cn } from '../../lib/cn';
import { TONE_CLASS, type Tone } from '../../theme/tone';

export interface StatusDotProps extends React.ComponentProps<'span'> {
  tone: Tone;
  /** Nhấp nháy — dùng cho trạng thái "đang chạy / live". */
  pulse?: boolean;
  size?: 'xs' | 'sm' | 'md';
}

const SIZE = { xs: 'size-1.5', sm: 'size-2', md: 'size-2.5' } as const;

export function StatusDot({ tone, pulse, size = 'sm', className, ...props }: StatusDotProps) {
  return (
    <span className={cn('relative inline-flex shrink-0', SIZE[size], className)} {...props}>
      {pulse && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60', TONE_CLASS[tone].dot)} />}
      <span className={cn('relative inline-flex rounded-full', SIZE[size], TONE_CLASS[tone].dot)} />
    </span>
  );
}

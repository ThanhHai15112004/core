import React from 'react';
import { EyeOff } from 'lucide-react';
import { cn } from '../../lib/cn';

/** Nội dung bị ẩn có chủ đích (giá trị nhạy cảm, xem trước đang tắt…) — nói rõ lý do, không hiện gì thêm. */
export function HiddenValue({ title, reason, action, className }: { title: React.ReactNode; reason?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 rounded-md border border-dashed border-border-strong bg-panel-2 px-3 py-2.5', className)}>
      <EyeOff className="size-4 shrink-0 text-faint" />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-fg-2">{title}</div>
        {reason && <div className="text-xs text-muted">{reason}</div>}
      </div>
      {action}
    </div>
  );
}

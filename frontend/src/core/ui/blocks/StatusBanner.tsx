import React from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, CircleHelp, Info, type LucideIcon } from 'lucide-react';
import { cn } from '../../lib/cn';
import { TONE_CLASS, type Tone } from '../../theme/tone';

export interface BannerReason {
  id?: string;
  text: React.ReactNode;
  onClick?: () => void;
}

export interface StatusBannerProps {
  tone: Tone;
  title: React.ReactNode;
  description?: React.ReactNode;
  reasons?: BannerReason[];
  /** Thông tin phụ bên phải (phiên bản, lần kiểm tra cuối…). */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

const TONE_ICON: Record<Tone, LucideIcon> = { ok: CheckCircle2, warn: AlertTriangle, crit: AlertOctagon, info: Info, unknown: CircleHelp };

/** Một dòng trạng thái tổng của trang: ổn / cảnh báo / sự cố + lý do bấm được. */
export function StatusBanner({ tone, title, description, reasons, meta, actions, className }: StatusBannerProps) {
  const Icon = TONE_ICON[tone];
  const multiline = Boolean(description) || (reasons?.length ?? 0) > 0;
  return (
    <section className={cn('mb-4 flex flex-wrap gap-3 rounded-lg border px-4 py-2.5', multiline ? 'items-start' : 'items-center', TONE_CLASS[tone].soft, className)} role={tone === 'crit' ? 'alert' : 'status'}>
      <Icon className={cn('size-5 shrink-0', multiline && 'mt-0.5', TONE_CLASS[tone].fg)} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{title}</div>
        {description && <div className="mt-0.5 text-sm text-fg-2">{description}</div>}
        {reasons && reasons.length > 0 && (
          <ul className="mt-1.5 flex flex-col gap-0.5 text-sm text-fg-2">
            {reasons.map((r, i) => (
              <li key={r.id ?? i} className="flex gap-2">
                <span aria-hidden="true" className="text-faint">
                  •
                </span>
                {r.onClick ? (
                  <button type="button" onClick={r.onClick} className="text-left underline-offset-2 hover:text-fg hover:underline">
                    {r.text}
                  </button>
                ) : (
                  <span>{r.text}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {(meta || actions) && (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 text-xs text-muted">
          {meta}
          {actions && <div className="flex gap-2">{actions}</div>}
        </div>
      )}
    </section>
  );
}

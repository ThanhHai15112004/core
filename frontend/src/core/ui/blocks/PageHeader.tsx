import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Settings2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useLocale } from '../../i18n/index';
import type { Tone } from '../../theme/tone';
import { Badge } from '../primitives/badge';
import { Button } from '../primitives/button';
import { StatusDot } from './StatusDot';

export interface PageHeaderProps {
  title: React.ReactNode;
  icon?: LucideIcon;
  /** Trạng thái tổng của trang (chip cạnh tiêu đề). */
  status?: { tone: Tone; label: string };
  description?: React.ReactNode;
  /** Thông tin phụ dòng dưới (vd. "Cập nhật 5 giây trước"). */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  /** Có → hiện nút ⚙ mở cấu hình. */
  onSettings?: () => void;
  className?: string;
}

export function PageHeader({ title, icon: Icon, status, description, meta, actions, onSettings, className }: PageHeaderProps) {
  const { t } = useLocale();
  return (
    <header className={cn('mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          {Icon && <Icon className="size-5 shrink-0 text-muted" />}
          <h1 className="text-lg font-semibold text-fg">{title}</h1>
          {status && (
            <Badge tone={status.tone}>
              <StatusDot tone={status.tone} size="xs" />
              {status.label}
            </Badge>
          )}
        </div>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p>}
        {meta && <div className="mt-1 text-xs text-faint">{meta}</div>}
      </div>
      {(actions || onSettings) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
          {onSettings && (
            <Button variant="secondary" size="sm" onClick={onSettings}>
              <Settings2 />
              {t('ui.action.settings')}
            </Button>
          )}
        </div>
      )}
    </header>
  );
}

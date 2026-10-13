import React from 'react';
import { AlertTriangle, DatabaseZap, Inbox, RefreshCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useLocale } from '../../i18n/index';
import { errorMessage } from '../../data/error-message';
import { Button } from '../primitives/button';
import { Skeleton } from '../primitives/skeleton';
import { TABLE_SKELETON_ROWS } from '../../constants/ui.constants';

export type PanelStatus = 'loading' | 'error' | 'empty' | 'no-source';

export interface PanelStateProps {
  status: PanelStatus;
  error?: unknown;
  onRetry?: () => void;
  /** Ghi đè câu thông báo mặc định. */
  message?: React.ReactNode;
  /** Kiểu khung chờ khi loading. */
  skeleton?: 'rows' | 'chart' | 'block';
  compact?: boolean;
  className?: string;
}

const ICON = { error: AlertTriangle, empty: Inbox, 'no-source': DatabaseZap } as const;

/** Trạng thái thống nhất cho mọi panel: đang tải / lỗi (thử lại) / trống / chưa có nguồn. */
export function PanelState({ status, error, onRetry, message, skeleton = 'rows', compact, className }: PanelStateProps) {
  const { t } = useLocale();
  if (status === 'loading') {
    if (skeleton === 'chart') return <Skeleton className={cn('h-48 w-full', className)} />;
    if (skeleton === 'block') return <Skeleton className={cn('h-20 w-full', className)} />;
    return (
      <div className={cn('flex flex-col gap-2', className)} aria-busy="true">
        {Array.from({ length: TABLE_SKELETON_ROWS }, (_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }
  const Icon = ICON[status];
  const text = message ?? (status === 'error' ? t('ui.state.error') : status === 'no-source' ? t('ui.state.noSource') : t('ui.state.empty'));
  const detail = status === 'error' ? errorMessage(error) : undefined;
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2 text-center', compact ? 'py-4' : 'py-10', className)} role={status === 'error' ? 'alert' : undefined}>
      <Icon className={cn('size-6', status === 'error' ? 'text-crit' : 'text-faint')} />
      <div className={cn('text-sm', status === 'error' ? 'text-crit-fg' : 'text-muted')}>{text}</div>
      {detail && <div className="max-w-md text-xs text-faint">{detail}</div>}
      {status === 'error' && onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <RefreshCw />
          {t('ui.state.retry')}
        </Button>
      )}
    </div>
  );
}

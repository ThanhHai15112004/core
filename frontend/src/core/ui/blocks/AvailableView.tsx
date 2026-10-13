import React from 'react';
import { useLocale } from '../../i18n/index';
import { PanelState } from './PanelState';

/** Một phần số liệu backend có thể không có (driver không hỗ trợ / chưa kết nối / lỗi riêng phần này). */
export type Availability<T> =
  | { available: true; data: T }
  | { available: false; reason: 'unsupported' | 'disconnected' | 'error'; message: string | null };

interface AvailableViewProps<T> {
  /** `undefined`/`null` = đang tải. */
  source: Availability<T> | null | undefined;
  /** Ghi đè câu thông báo theo lý do (đã dịch). */
  messages?: Partial<Record<'unsupported' | 'disconnected' | 'error', React.ReactNode>>;
  onRetry?: () => void;
  compact?: boolean;
  skeleton?: 'rows' | 'chart' | 'block';
  children: (data: T) => React.ReactNode;
}

/** Hiển thị phần số liệu khi có; không có thì nói rõ lý do — phần lỗi không làm hỏng cả trang. */
export function AvailableView<T>({ source, messages, onRetry, compact = true, skeleton, children }: AvailableViewProps<T>) {
  const { t } = useLocale();
  if (!source) return <PanelState status="loading" skeleton={skeleton} compact={compact} />;
  if (source.available) return <>{children(source.data)}</>;
  if (source.reason === 'error') {
    return (
      <PanelState
        status="error"
        compact={compact}
        message={messages?.error ?? t('ui.source.error')}
        error={source.message ? new Error(source.message) : undefined}
        onRetry={onRetry}
      />
    );
  }
  return <PanelState status="no-source" compact={compact} message={messages?.[source.reason] ?? t(`ui.source.${source.reason}`)} />;
}

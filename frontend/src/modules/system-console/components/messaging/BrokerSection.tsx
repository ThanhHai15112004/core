import React from 'react';
import { useLocale } from '@core/i18n/index';
import { PanelState } from '@core/ui/blocks';
import type { Section } from '../../types/messaging.types';

interface Props<T> {
  /** `undefined` = đang tải. */
  section: Section<T> | undefined;
  /** Tên broker (câu "không hỗ trợ"). */
  product?: string;
  onRetry?: () => void;
  compact?: boolean;
  children: (data: T) => React.ReactNode;
}

/**
 * Một phần số liệu đọc từ broker: có dữ liệu → render; không thì nói rõ lý do (broker không hỗ trợ / mất kết nối /
 * lỗi riêng phần này) — phần lỗi không làm hỏng cả trang.
 */
export function BrokerSection<T>({ section, product, onRetry, compact = true, children }: Props<T>) {
  const { t } = useLocale();
  if (!section) return <PanelState status="loading" compact={compact} />;
  if (section.available) return <>{children(section.data)}</>;
  if (section.reason === 'unsupported') return <PanelState status="no-source" compact={compact} message={t('messaging.section.unsupported', { driver: product ?? '' })} />;
  if (section.reason === 'disconnected') return <PanelState status="no-source" compact={compact} message={t('messaging.section.disconnected')} />;
  return <PanelState status="error" compact={compact} message={t('messaging.section.error')} error={section.message ? new Error(section.message) : undefined} onRetry={onRetry} />;
}

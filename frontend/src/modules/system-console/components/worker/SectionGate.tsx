import React from 'react';
import { useLocale } from '@core/i18n/index';
import { PanelState } from '@core/ui/blocks';
import type { Section } from '../../types/worker.types';

interface Props<T> {
  section: Section<T>;
  /** Tên provider hiển thị khi phần này không được hỗ trợ. */
  product?: string;
  className?: string;
  children: (data: T) => React.ReactNode;
}

/** Phần dữ liệu provider có thể không cung cấp: không hỗ trợ / chưa kết nối / lỗi → nói rõ lý do, không số giả. */
export function SectionGate<T>({ section, product, className, children }: Props<T>) {
  const { t } = useLocale();
  if (section.available) return <>{children(section.data)}</>;
  const message =
    section.reason === 'unsupported'
      ? t('wq.section.unsupported', { driver: product ?? '' })
      : section.reason === 'disconnected'
        ? t('wq.section.disconnected')
        : t('wq.section.error', { message: section.message ?? '' });
  return <PanelState status={section.reason === 'error' ? 'error' : 'no-source'} message={message} compact className={className} />;
}

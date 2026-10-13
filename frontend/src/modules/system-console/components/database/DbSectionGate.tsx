import React from 'react';
import { useLocale } from '@core/i18n/index';
import { PanelState } from '@core/ui/blocks';
import type { Section } from '../../types/database.types';

interface DbSectionGateProps<T> {
  section: Section<T>;
  driver?: string;
  onRetry?: () => void;
  compact?: boolean;
  children: (data: T) => React.ReactNode;
}

/** Một phần số liệu, hoặc lý do không có (driver không hỗ trợ / chưa kết nối / lỗi riêng phần này) — không làm hỏng cả trang. */
export function DbSectionGate<T>({ section, driver, onRetry, compact = true, children }: DbSectionGateProps<T>): React.ReactElement {
  const { t } = useLocale();
  if (section.available) return <>{children(section.data)}</>;
  if (section.reason === 'error') return <PanelState status="error" message={t('db.section.error', { message: section.message ?? '' })} onRetry={onRetry} compact={compact} />;
  return (
    <PanelState
      status="no-source"
      message={section.reason === 'unsupported' ? t('db.section.unsupported', { driver: driver ?? '' }) : t('db.section.disconnected')}
      compact={compact}
    />
  );
}

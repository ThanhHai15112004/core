import React from 'react';
import { useLocale } from '@core/i18n/index';
import { PanelState } from '@core/ui/blocks';
import type { Section } from '../../types/worker.types';

/**
 * Một phần dữ liệu đọc từ queue provider: chưa có → khung chờ; provider không hỗ trợ / mất kết nối → nói rõ lý do
 * (không hiện bảng rỗng như thể "không có job").
 */
export function ProviderSection<T>({ section, children }: { section: Section<T> | undefined; children: (data: T) => React.ReactNode }) {
  const { t } = useLocale();
  if (!section) return <PanelState status="loading" />;
  if (!section.available) return <PanelState status="no-source" compact message={t('jobs.unavailableSection', { reason: t(`jobs.reason.${section.reason}`) })} />;
  return <>{children(section.data)}</>;
}

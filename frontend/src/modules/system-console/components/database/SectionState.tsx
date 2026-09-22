import React from 'react';
import { Ban, PlugZap, RefreshCw, TriangleAlert } from 'lucide-react';
import type { Section } from '../../types/database.types';
import { useLocale } from '../../../../core/i18n/index';

interface SectionStateProps<T> {
  section: Section<T> | null | undefined;
  driver?: string;
  onRetry?: () => void;
  children: (data: T) => React.ReactNode;
}

/**
 * Hiển thị một phần số liệu hoặc lý do không có (driver không hỗ trợ / chưa kết nối / lỗi riêng phần này).
 * Phần lỗi không làm hỏng cả trang.
 */
export function SectionState<T>({ section, driver, onRetry, children }: SectionStateProps<T>): React.ReactElement {
  const { t } = useLocale();
  if (!section) return <p className="ov-empty-line">{t('common.loading')}</p>;
  if (section.available) return <>{children(section.data)}</>;
  const Icon = section.reason === 'unsupported' ? Ban : section.reason === 'disconnected' ? PlugZap : TriangleAlert;
  return (
    <div className={`db-section-state is-${section.reason}`} role="status">
      <Icon size={16} />
      <span>
        {section.reason === 'unsupported'
          ? t('db.section.unsupported', { driver: driver ?? '' })
          : section.reason === 'disconnected'
            ? t('db.section.disconnected')
            : t('db.section.error', { message: section.message ?? '' })}
      </span>
      {section.reason === 'error' && onRetry && (
        <button type="button" className="ov-link" onClick={onRetry}>
          <RefreshCw size={12} /> {t('db.section.retry')}
        </button>
      )}
    </div>
  );
}

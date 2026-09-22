import React from 'react';
import { Radar } from 'lucide-react';
import { SectionHeader } from './SectionHeader';
import { EmptyState } from './EmptyState';
import { useLocale } from '../../../../core/i18n/index';

interface UnmonitoredRuntimeProps {
  /** Khóa i18n gốc, vd. `console.worker`. */
  i18nKey: string;
  sourcePath: string;
}

/** Hiển thị cho runtime chưa có API giám sát — không hiển thị dữ liệu mô phỏng. */
export const UnmonitoredRuntime: React.FC<UnmonitoredRuntimeProps> = ({ i18nKey, sourcePath }) => {
  const { t } = useLocale();

  return (
    <div>
      <SectionHeader title={t(`${i18nKey}.title`)} description={t(`${i18nKey}.description`)} />
      <EmptyState
        icon={<Radar size={36} style={{ color: 'var(--scp-text-muted)' }} />}
        title={t('console.unmonitored.title')}
        description={t('console.unmonitored.description', { path: sourcePath })}
      />
    </div>
  );
};

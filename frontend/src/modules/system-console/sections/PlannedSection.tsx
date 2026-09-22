import React from 'react';
import { Construction, ArrowRight } from 'lucide-react';
import type { ConsolePath, ConsoleSectionId } from '../types/console.types';
import { SectionHeader } from '../components/common/SectionHeader';
import { EmptyState } from '../components/common/EmptyState';
import { useConsoleRoute } from '../context/console-route-context';
import { useLocale } from '../../../core/i18n/index';

/** Trang đã có dữ liệu thật liên quan, để người dùng không bị "ngõ cụt". */
const RELATED: Partial<Record<ConsoleSectionId, ConsolePath>> = {
  performance: 'runtimes',
  storage: 'packages',
  messaging: 'runtimes/worker',
  worker: 'runtimes/worker',
  scheduler: 'runtimes/scheduler',
  jobs: 'runtimes/worker',
  secrets: 'security',
  configuration: 'runtimes/api/configuration',
};

interface PlannedSectionProps {
  sectionId: ConsoleSectionId;
}

/** Tab chưa triển khai: nói rõ là chưa có, không hiển thị dữ liệu mô phỏng. */
export const PlannedSection: React.FC<PlannedSectionProps> = ({ sectionId }) => {
  const { t } = useLocale();
  const { navigate } = useConsoleRoute();
  const related = RELATED[sectionId];

  return (
    <div>
      <SectionHeader title={t(`nav.${sectionId}`)} description={t(`planned.description.${sectionId}`)} />
      <EmptyState
        icon={<Construction size={36} style={{ color: 'var(--scp-text-muted)' }} />}
        title={t('planned.title')}
        description={t('planned.message')}
        action={
          related ? (
            <button type="button" className="scp-btn scp-btn-secondary" onClick={() => navigate(related)}>
              {t(`planned.related.${sectionId}`)} <ArrowRight size={14} />
            </button>
          ) : undefined
        }
      />
    </div>
  );
};

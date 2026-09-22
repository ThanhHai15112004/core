import React from 'react';
import type { ConsoleSectionId, HealthMapCategory, HealthMapItem } from '../../types/console.types';
import { ConsoleIcon } from '../common/ConsoleIcon';
import { useLocale } from '../../../../core/i18n/index';
import { Layers } from 'lucide-react';

interface SystemHealthMapProps {
  items: HealthMapItem[];
  onNavigate: (section: ConsoleSectionId) => void;
}

const resolveHealthMapIcon = (id: string, fallbackSection: ConsoleSectionId) => {
  if (id === 'runtime-api') return <ConsoleIcon name="api" size={16} />;
  if (id === 'infra-storage') return <ConsoleIcon name="storage" size={16} />;
  if (id === 'infra-messaging') return <ConsoleIcon name="messaging" size={16} />;
  return <ConsoleIcon name={fallbackSection} size={16} />;
};

export const SystemHealthMap: React.FC<SystemHealthMapProps> = ({
  items,
  onNavigate,
}) => {
  const { t } = useLocale();
  const categories: HealthMapCategory[] = ['runtime', 'infrastructure', 'governance'];

  const getCategoryLabel = (category: HealthMapCategory) => {
    switch (category) {
      case 'runtime':
        return t('healthMap.runtimes');
      case 'infrastructure':
        return t('healthMap.infrastructure');
      case 'governance':
        return t('healthMap.governance');
    }
  };

  const getItemName = (item: HealthMapItem) => {
    switch (item.id) {
      case 'runtime-api':
        return t('healthMap.apiGateway');
      case 'runtime-worker':
        return t('healthMap.worker');
      case 'runtime-scheduler':
        return t('healthMap.scheduler');
      case 'infra-db':
        return t('healthMap.database');
      case 'infra-cache':
        return t('healthMap.cache');
      case 'infra-storage':
        return t('healthMap.storage');
      case 'infra-messaging':
        return t('healthMap.messaging');
      case 'gov-security':
        return t('healthMap.security');
      default:
        return item.name;
    }
  };

  return (
    <section className="health-map-panel" aria-label="System Health Map">
      <div className="health-map-header">
        <h3 className="health-map-title">
          <Layers size={17} style={{ color: 'var(--scp-primary)' }} />
          <span>{t('healthMap.title')}</span>
        </h3>
        <span style={{ fontSize: '0.75rem', color: 'var(--scp-text-muted)' }}>
          {t('healthMap.subtitle')}
        </span>
      </div>

      <div className="health-map-groups">
        {categories.map((category) => {
          const groupItems = items.filter((item) => item.category === category);
          if (groupItems.length === 0) return null;

          return (
            <div key={category} className="health-map-group">
              <div className="health-map-group-label">
                {getCategoryLabel(category)}
              </div>

              <div className="health-map-cards-row">
                {groupItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="health-map-card"
                    onClick={() => onNavigate(item.targetSection)}
                    title={`Click to open ${getItemName(item)} details`}
                  >
                    <div className="health-map-card-top">
                      <span className="health-map-card-name">
                        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                          {resolveHealthMapIcon(item.id, item.targetSection)}
                        </span>
                        <span>{getItemName(item)}</span>
                      </span>
                      <span
                        className={`health-status-dot dot-${item.status}`}
                        aria-label={`Status: ${item.status}`}
                      />
                    </div>

                    <div className="health-map-card-subtext">{item.subtext}</div>

                    {item.secondarySubtext && (
                      <div className="health-map-card-detail">{item.secondarySubtext}</div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

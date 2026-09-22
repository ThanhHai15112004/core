import React from 'react';
import type { ConsoleSectionId, HealthMapCategory, HealthMapItem } from '../../types/console.types';
import { ConsoleIcon } from '../common/ConsoleIcon';
import { toneOf } from '../../utils/status-tone';
import { useLocale } from '../../../../core/i18n/index';

interface SystemHealthMapProps {
  items: HealthMapItem[];
  onNavigate: (section: ConsoleSectionId) => void;
}

const CATEGORIES: HealthMapCategory[] = ['runtime', 'infrastructure', 'governance'];

/** Vùng ③: mỗi thành phần có sống không — click để drill-down. */
export const SystemHealthMap: React.FC<SystemHealthMapProps> = ({ items, onNavigate }) => {
  const { t } = useLocale();

  return (
    <section className="ov-card ov-section" aria-labelledby="ov-map-title">
      <header className="ov-section-head">
        <h3 id="ov-map-title">{t('healthMap.title')}</h3>
        <span className="ov-section-hint">{t('ov.map.hint')}</span>
      </header>

      <div className="ov-map">
        {CATEGORIES.map((category) => {
          const group = items.filter((i) => i.category === category);
          if (group.length === 0) return null;
          return (
            <div key={category} className="ov-map-group">
              <h4 className="ov-map-group-title">{t(`ov.map.category.${category}`)}</h4>
              <div className="ov-map-items">
                {group.map((item) => {
                  const tone = toneOf(item.status);
                  const name = item.name === item.id ? t(`ov.map.item.${item.id}`) : item.name;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`ov-map-item ov-tone-${tone}`}
                      onClick={() => onNavigate(item.targetSection)}
                      title={item.secondarySubtext ?? item.subtext}
                    >
                      <span className="ov-map-item-head">
                        <ConsoleIcon name={item.icon} size={15} />
                        <span className="ov-map-item-name">{name}</span>
                        <span className="ov-dot" aria-label={t(`console.status.${item.status}`)} />
                      </span>
                      <span className="ov-map-item-metric">{item.metric ?? t(`console.status.${item.status}`)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};

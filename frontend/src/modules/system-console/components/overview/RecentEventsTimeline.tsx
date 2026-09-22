import React, { useState } from 'react';
import type { ConsoleSectionId, RecentActivityEvent, EventLogLevel } from '../../types/console.types';
import { useLocale } from '../../../../core/i18n/index';
import { StatusPill } from '../common/StatusPill';
import { Clock3 } from 'lucide-react';

interface RecentEventsTimelineProps {
  events: RecentActivityEvent[];
  onNavigate: (section: ConsoleSectionId) => void;
}

type FilterLevel = 'all' | EventLogLevel;

export const RecentEventsTimeline: React.FC<RecentEventsTimelineProps> = ({
  events,
  onNavigate,
}) => {
  const { t } = useLocale();
  const [filter, setFilter] = useState<FilterLevel>('all');

  const filteredEvents = events.filter((ev) => {
    if (filter === 'all') return true;
    return ev.level === filter;
  });

  const getFilterLabel = (lvl: FilterLevel) => {
    switch (lvl) {
      case 'all':
        return t('timeline.filterAll');
      case 'error':
        return t('timeline.filterError');
      case 'warn':
        return t('timeline.filterWarn');
      case 'info':
        return t('timeline.filterInfo');
      default:
        return lvl;
    }
  };

  return (
    <section className="recent-events-panel" aria-label="Recent Operational Activity">
      <div className="recent-events-header">
        <h3 className="recent-events-title">
          <Clock3 size={17} style={{ color: 'var(--scp-primary)' }} />
          <span>{t('timeline.title')}</span>
        </h3>

        <div className="recent-events-filters">
          {(['all', 'error', 'warn', 'info'] as FilterLevel[]).map((lvl) => (
            <button
              key={lvl}
              type="button"
              className={`recent-filter-btn ${filter === lvl ? 'is-active' : ''}`}
              onClick={() => setFilter(lvl)}
            >
              {getFilterLabel(lvl)}
            </button>
          ))}
        </div>
      </div>

      <div className="recent-events-list">
        {filteredEvents.length === 0 ? (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--scp-text-muted)', fontSize: '0.85rem' }}>
            {t('timeline.emptyEvents')}
          </div>
        ) : (
          filteredEvents.map((ev) => (
            <div key={ev.id} className="recent-event-item">
              <span className="recent-event-time">{ev.time}</span>
              <StatusPill
                status={ev.level === 'warn' ? 'warning' : ev.level}
                label={ev.level.toUpperCase()}
              />
              <span className="recent-event-source">{ev.source}</span>
              <span className="recent-event-msg" title={ev.message}>
                {ev.message}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="recent-events-footer">
        <button
          type="button"
          className="scp-btn scp-btn-sm scp-btn-secondary"
          onClick={() => onNavigate('logs')}
        >
          {t('timeline.openLogViewer')}
        </button>
      </div>
    </section>
  );
};

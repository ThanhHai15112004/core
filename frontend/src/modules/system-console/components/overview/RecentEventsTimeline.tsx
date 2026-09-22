import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { ConsolePath, RecentActivityEvent } from '../../types/console.types';
import { toneOf } from '../../utils/status-tone';
import { useLocale } from '../../../../core/i18n/index';

interface RecentEventsTimelineProps {
  events: RecentActivityEvent[];
  onNavigate: (path: ConsolePath) => void;
}

const FILTERS = ['all', 'error', 'warn'] as const;
type Filter = (typeof FILTERS)[number];
const MAX_VISIBLE = 8;

/** Vùng ⑦: vài sự kiện đáng chú ý gần nhất, không phải full log. */
export const RecentEventsTimeline: React.FC<RecentEventsTimelineProps> = ({ events, onNavigate }) => {
  const { t, formatTime } = useLocale();
  const [filter, setFilter] = useState<Filter>('all');
  const visible = events.filter((e) => filter === 'all' || e.level === filter).slice(0, MAX_VISIBLE);

  return (
    <section className="ov-card ov-section" aria-labelledby="ov-events-title">
      <header className="ov-section-head">
        <h3 id="ov-events-title">{t('timeline.title')}</h3>
        <div className="ov-segmented" role="tablist">
          {FILTERS.map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'is-active' : ''} onClick={() => setFilter(f)}>
              {t(`console.logs.level.${f}`)}
            </button>
          ))}
        </div>
      </header>

      {visible.length === 0 ? (
        <p className="ov-empty-line">{t('timeline.emptyEvents')}</p>
      ) : (
        <ol className="ov-events">
          {visible.map((ev) => (
            <li key={ev.id} className={`ov-event ov-tone-${toneOf(ev.level)}`}>
              <time dateTime={ev.time}>{formatTime(ev.time)}</time>
              <span className="ov-event-level">{t(`console.logs.level.${ev.level}`)}</span>
              <span className="ov-event-source">{ev.source}</span>
              <span className="ov-event-msg">{ev.message}</span>
            </li>
          ))}
        </ol>
      )}

      <footer className="ov-section-foot">
        <button type="button" className="ov-link" onClick={() => onNavigate('logs')}>
          {t('timeline.openLogViewer')} <ArrowRight size={13} />
        </button>
      </footer>
    </section>
  );
};

import React, { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import type { PerfEvent } from '../../types/performance.types';
import { EVENTS_PREVIEW } from '../../constants/performance';
import { useLocale } from '../../../../core/i18n/index';

const TONE = { info: 'unknown', warning: 'warn', critical: 'crit', success: 'ok' } as const;

/** Dòng thời gian: điểm nghẽn bắt đầu/hồi phục và sự kiện runtime (khởi động, crash, dừng). */
export const PerfEventsList: React.FC<{ events: PerfEvent[] | null; onOpen: (target: string) => void }> = ({ events, onOpen }) => {
  const { t, formatTime } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const list = events ?? [];
  const shown = expanded ? list : list.slice(0, EVENTS_PREVIEW);
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('perf.events.title')}</h3>
        <span className="ov-section-hint">{t('perf.events.hint')}</span>
      </header>
      {events === null ? (
        <p className="ov-empty-line">{t('common.loading')}</p>
      ) : list.length === 0 ? (
        <p className="ov-empty-line">{t('perf.events.empty')}</p>
      ) : (
        <ol className="pf-events">
          {shown.map((e) => (
            <li key={e.id} className={`ov-tone-${TONE[e.severity]}`}>
              <time dateTime={e.at}>
                {new Date(e.at).toLocaleDateString()} {formatTime(Date.parse(e.at))}
              </time>
              <span className="ov-dot" aria-hidden="true" />
              <span className="pf-event-body">
                <strong>{e.title}</strong>
                <span>{e.message}</span>
              </span>
              {e.target && (
                <button type="button" className="ov-link" onClick={() => onOpen(e.target!)}>
                  {t('perf.events.open')} <ArrowRight size={12} />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      {list.length > EVENTS_PREVIEW && (
        <footer className="ov-section-foot">
          <button type="button" className="ov-link" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t('perf.events.less') : t('perf.events.more', { count: list.length - EVENTS_PREVIEW })}
          </button>
        </footer>
      )}
    </section>
  );
};

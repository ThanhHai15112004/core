import React from 'react';
import type { RuntimeEvent } from '../../types/runtime.types';
import { toneOf } from '../../utils/status-tone';
import { useLocale } from '../../../../core/i18n/index';

interface RuntimeEventsListProps {
  events: RuntimeEvent[] | null;
  title: string;
  showRuntime?: boolean;
  footer?: React.ReactNode;
}

/** Timeline sự kiện vòng đời runtime (start/stop/crash/restart/ngưỡng) — dữ liệu từ Redis Stream. */
export const RuntimeEventsList: React.FC<RuntimeEventsListProps> = ({ events, title, showRuntime = true, footer }) => {
  const { t, formatTime } = useLocale();
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{title}</h3>
      </header>
      {!events ? (
        <p className="ov-empty-line">{t('common.loading')}</p>
      ) : events.length === 0 ? (
        <p className="ov-empty-line">{t('rt.events.empty')}</p>
      ) : (
        <ol className="ov-events">
          {events.map((e) => (
            <li key={e.id} className={`ov-event ov-tone-${toneOf(e.level)} ${showRuntime ? '' : 'rt-event-compact'}`}>
              <time dateTime={e.at}>
                {new Date(e.at).toDateString() === new Date().toDateString()
                  ? formatTime(e.at)
                  : `${new Date(e.at).toLocaleDateString()} ${formatTime(e.at, false)}`}
              </time>
              <span className="ov-event-level">{t(`console.logs.level.${e.level}`)}</span>
              {showRuntime && <span className="ov-event-source">{e.runtimeName}</span>}
              <span className="ov-event-msg" title={e.message}>
                {e.message}
              </span>
            </li>
          ))}
        </ol>
      )}
      {footer && <footer className="ov-section-foot">{footer}</footer>}
    </section>
  );
};

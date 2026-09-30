import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { WorkerEvent } from '../../types/worker.types';
import { useLocale } from '../../../../core/i18n/index';

const TONE = { info: 'unknown', warning: 'warn', critical: 'crit', success: 'ok' } as const;

/** Dòng thời gian: backlog vượt ngưỡng, queue pause/resume, retry, worker restart, cảnh báo hồi phục. */
export const WorkerEventList: React.FC<{ events: WorkerEvent[] | null; onOpen: (event: WorkerEvent) => void; emptyText: string }> = ({ events, onOpen, emptyText }) => {
  const { t, formatTime } = useLocale();
  if (events === null) return <p className="ov-empty-line">{t('common.loading')}</p>;
  if (events.length === 0) return <p className="ov-empty-line">{emptyText}</p>;
  return (
    <ol className="pf-events">
      {events.map((e) => (
        <li key={e.id} className={`ov-tone-${TONE[e.severity]}`}>
          <time dateTime={e.at}>
            {new Date(e.at).toLocaleDateString()} {formatTime(Date.parse(e.at))}
          </time>
          <span className="ov-dot" aria-hidden="true" />
          <span className="pf-event-body">
            <strong>{t(`wq.event.${e.type}`)}</strong>
            <span>{e.message}</span>
          </span>
          {(e.tab || e.queue) && (
            <button type="button" className="ov-link" onClick={() => onOpen(e)}>
              {t('perf.events.open')} <ArrowRight size={12} />
            </button>
          )}
        </li>
      ))}
    </ol>
  );
};

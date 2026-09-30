import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { SchedulerEvent } from '../../types/scheduler.types';
import { useLocale } from '../../../../core/i18n/index';

const TONE = { info: 'unknown', warning: 'warn', critical: 'crit', success: 'ok' } as const;

/** Dòng thời gian: chạy thủ công, bật/tắt task, lỗi / hồi phục, lỡ lịch, instance vào/ra, cảnh báo. */
export const SchedulerEventList: React.FC<{ events: SchedulerEvent[] | null; onOpen: (e: SchedulerEvent) => void; emptyText: string }> = ({ events, onOpen, emptyText }) => {
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
            <strong>{t(`sch.event.${e.type}`)}</strong>
            <span>{e.message}</span>
          </span>
          {(e.executionId || e.taskId) && (
            <button type="button" className="ov-link" onClick={() => onOpen(e)}>
              {t('perf.events.open')} <ArrowRight size={12} />
            </button>
          )}
        </li>
      ))}
    </ol>
  );
};

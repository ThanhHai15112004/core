import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { CacheEvent, CacheTab } from '../../types/cache.types';
import { useLocale } from '../../../../core/i18n/index';

const TONE = { info: 'unknown', warning: 'warn', critical: 'crit', success: 'ok' } as const;

/** Dòng thời gian sự kiện cache (kết nối, cảnh báo, thao tác quản trị). */
export const CacheEventList: React.FC<{ events: CacheEvent[] | null; onOpen: (tab: CacheTab) => void; emptyText: string }> = ({
  events,
  onOpen,
  emptyText,
}) => {
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
            <strong>{t(`cache.event.${e.type}`)}</strong>
            <span>{e.message}</span>
          </span>
          {e.tab && (
            <button type="button" className="ov-link" onClick={() => onOpen(e.tab!)}>
              {t('perf.events.open')} <ArrowRight size={12} />
            </button>
          )}
        </li>
      ))}
    </ol>
  );
};

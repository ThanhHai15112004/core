import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Concentration, Upcoming } from '../../types/scheduler.types';
import { formatIn, secondsUntil } from '../../utils/scheduler-format';
import { useLocale } from '../../../../core/i18n/index';

/** Upcoming: sắp chạy gì, bao lâu nữa — không cần tự đọc cron expression. */
export const UpcomingList: React.FC<{ items: Upcoming[]; now: number; onOpenTask: (taskId: string) => void; emptyText: string; showTime?: boolean }> = ({
  items,
  now,
  onOpenTask,
  emptyText,
  showTime = false,
}) => {
  const { t, formatTime } = useLocale();
  if (items.length === 0) return <p className="ov-empty-line">{emptyText}</p>;
  return (
    <div className="scp-table-wrap">
      <table className="scp-table">
        <thead>
          <tr>
            <th>{t('sch.upcoming.in')}</th>
            {showTime && <th>{t('sch.upcoming.at')}</th>}
            <th>{t('sch.task.name')}</th>
            <th>{t('sch.task.schedule')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((u) => (
            <tr key={`${u.taskId}-${u.at}`} className="is-clickable" onClick={() => onOpenTask(u.taskId)}>
              <td className="cell-strong">{formatIn(secondsUntil(u.at, now))}</td>
              {showTime && (
                <td>
                  {new Date(u.at).toLocaleDateString()} {formatTime(Date.parse(u.at), false)}
                </td>
              )}
              <td>{u.taskName}</td>
              <td>
                {u.description}
                {u.expression && (
                  <small className="pf-row-note">
                    <code>{u.expression}</code>
                  </small>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/** Execution Concentration: nhiều task dồn vào cùng cửa sổ 5 phút — chỉ giúp nhìn thấy, không tự sửa lịch. */
export const ConcentrationNotes: React.FC<{ items: Concentration[] }> = ({ items }) => {
  const { t, formatTime } = useLocale();
  if (items.length === 0) return null;
  return (
    <ul className="db-alerts">
      {items.map((c) => (
        <li key={c.from} className="ov-tone-warn">
          <AlertTriangle size={14} />
          <span className="db-alert-body">
            <strong>{t('sch.concentration.title', { count: c.count })}</strong>
            <span>
              {t('sch.concentration.window', { from: formatTime(Date.parse(c.from), false), to: formatTime(Date.parse(c.to), false) })}: {c.tasks.join(', ')}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
};

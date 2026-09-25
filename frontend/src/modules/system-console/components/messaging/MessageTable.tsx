import React from 'react';
import type { MessageRow } from '../../types/messaging.types';
import { MESSAGE_STATUS_TONE } from '../../constants/messaging';
import { formatBytes, formatDuration } from '../../utils/database-format';
import { shortId } from '../../utils/messaging-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

type Column = 'time' | 'id' | 'channel' | 'status' | 'attempts' | 'duration' | 'error' | 'next' | 'size';

/** Bảng message dùng chung (explorer, retry, dead letter, drawer) — cột chọn theo ngữ cảnh. */
export const MessageTable: React.FC<{
  rows: MessageRow[];
  onOpen: (m: MessageRow) => void;
  columns?: Column[];
  emptyText: string;
  now: number;
  actions?: (m: MessageRow) => React.ReactNode;
}> = ({ rows, onOpen, columns = ['time', 'id', 'channel', 'status', 'duration', 'size'], emptyText, now, actions }) => {
  const { t, formatTime, formatRelative } = useLocale();
  if (rows.length === 0) return <p className="ov-empty-line">{emptyText}</p>;
  const has = (c: Column) => columns.includes(c);
  const when = (m: MessageRow) => m.finishedAt ?? m.processedAt ?? m.publishedAt;
  return (
    <div className="scp-table-wrap">
      <table className="scp-table cache-key-table">
        <thead>
          <tr>
            {has('time') && <th>{t('db.errors.time')}</th>}
            {has('id') && <th>{t('messaging.message.id')}</th>}
            {has('channel') && <th>{t('messaging.message.channel')}</th>}
            {has('status') && <th>{t('messaging.channel.status')}</th>}
            {has('attempts') && <th>{t('messaging.message.attempts')}</th>}
            {has('next') && <th>{t('messaging.message.nextAttempt')}</th>}
            {has('duration') && <th>{t('messaging.message.duration')}</th>}
            {has('error') && <th>{t('messaging.message.lastError')}</th>}
            {has('size') && <th>{t('messaging.message.size')}</th>}
            {actions && <th />}
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={`${m.queue}:${m.id}`} className="is-clickable" onClick={() => onOpen(m)}>
              {has('time') && <td>{formatTime(Date.parse(when(m)), true)}</td>}
              {has('id') && (
                <td>
                  <code title={m.id}>{shortId(m.id)}</code>
                </td>
              )}
              {has('channel') && (
                <td className="cache-key-cell">
                  <code>{m.channel}</code>
                  {m.producer && <small className="pf-row-note">{t('messaging.message.from', { producer: m.producer })}</small>}
                </td>
              )}
              {has('status') && (
                <td>
                  <span className={`pf-chip ov-tone-${MESSAGE_STATUS_TONE[m.status]}`}>{t(`messaging.status.${m.status}`)}</span>
                </td>
              )}
              {has('attempts') && (
                <td>
                  {m.attempts} / {m.maxAttempts}
                </td>
              )}
              {has('next') && <td>{m.nextAttemptAt ? formatRelative(new Date(m.nextAttemptAt), now) : NO_VALUE}</td>}
              {has('duration') && <td>{m.durationMs === null ? NO_VALUE : formatDuration(m.durationMs)}</td>}
              {has('error') && <td className="db-sql-cell">{m.error ?? NO_VALUE}</td>}
              {has('size') && <td className={m.large ? 'is-warn' : ''}>{formatBytes(m.size)}</td>}
              {actions && <td onClick={(e) => e.stopPropagation()}>{actions(m)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

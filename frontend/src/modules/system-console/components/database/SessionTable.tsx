import React from 'react';
import { OctagonX, Unplug } from 'lucide-react';
import type { DbSession } from '../../types/database.types';
import { SESSION_TONE } from '../../constants/database';
import { formatDuration } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

interface SessionTableProps {
  sessions: DbSession[];
  slowMs: number;
  mode: 'queries' | 'connections';
  actionsEnabled: boolean;
  canCancel: boolean;
  canTerminate: boolean;
  onOpen: (s: DbSession) => void;
  onCancel?: (s: DbSession) => void;
  onTerminate?: (s: DbSession) => void;
  emptyText: string;
}

/** Bảng session/query đang chạy: runtime nguồn, trạng thái, thời gian, SQL đã bỏ literal. */
export const SessionTable: React.FC<SessionTableProps> = ({ sessions, slowMs, mode, actionsEnabled, canCancel, canTerminate, onOpen, onCancel, onTerminate, emptyText }) => {
  const { t } = useLocale();
  if (sessions.length === 0) return <p className="ov-empty-line">{emptyText}</p>;
  return (
    <div className="scp-table-wrap">
      <table className="scp-table db-session-table">
        <thead>
          <tr>
            <th>{t('db.session.id')}</th>
            <th>{t('db.session.source')}</th>
            <th>{t('db.session.state')}</th>
            <th>{mode === 'queries' ? t('db.session.age') : t('db.session.time')}</th>
            <th>{t('db.session.query')}</th>
            <th aria-label={t('db.session.actions')} />
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const slow = s.state === 'active' && (s.queryMs ?? 0) >= slowMs;
            const tone = slow ? 'warn' : (SESSION_TONE[s.state] ?? 'unknown');
            return (
              <tr key={s.id} className="is-clickable" onClick={() => onOpen(s)}>
                <td>
                  <code>#{s.id}</code>
                  {s.isSelf && <small className="pf-row-note">{t('db.session.console')}</small>}
                </td>
                <td>{s.runtime ? t(`rt.name.${s.runtime}`) : (s.program ?? t('db.session.external'))}</td>
                <td>
                  <span className={`pf-chip ov-tone-${tone}`}>
                    <span className="ov-dot" aria-hidden="true" />
                    {slow ? t('db.session.slow') : t(`db.session.status.${s.state}`)}
                  </span>
                  {s.blockedBy.length > 0 && <small className="pf-row-note">{t('db.session.blockedBy', { ids: s.blockedBy.map((b) => `#${b}`).join(', ') })}</small>}
                </td>
                <td>{formatDuration(s.queryMs)}</td>
                <td className="db-sql-cell">
                  {s.isSelf ? <span className="pf-row-note">{t('db.session.consoleQuery')}</span> : <code>{s.query ?? NO_VALUE}</code>}
                </td>
                <td className="db-actions-cell" onClick={(e) => e.stopPropagation()}>
                  {!s.isSelf && canCancel && s.query && onCancel && (
                    <button type="button" className="rt-icon-btn" disabled={!actionsEnabled} title={actionsEnabled ? t('db.action.cancel') : t('db.action.disabled')} aria-label={t('db.action.cancel')} onClick={() => onCancel(s)}>
                      <OctagonX size={15} />
                    </button>
                  )}
                  {!s.isSelf && canTerminate && onTerminate && (
                    <button type="button" className="rt-icon-btn is-danger" disabled={!actionsEnabled} title={actionsEnabled ? t('db.action.terminate') : t('db.action.disabled')} aria-label={t('db.action.terminate')} onClick={() => onTerminate(s)}>
                      <Unplug size={15} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

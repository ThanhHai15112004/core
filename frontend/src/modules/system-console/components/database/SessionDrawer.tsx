import React, { useEffect, useState } from 'react';
import { OctagonX, Unplug } from 'lucide-react';
import type { DbConnectionDetail, DbSession } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { SESSION_TONE } from '../../constants/database';
import { formatDuration } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { DbDrawer } from './DbDrawer';
import { useLocale } from '../../../../core/i18n/index';

interface SessionDrawerProps {
  id: string;
  canCancel: boolean;
  canTerminate: boolean;
  onClose: () => void;
  onCancel: (s: DbSession) => void;
  onTerminate: (s: DbSession) => void;
  navigate: (path: string) => void;
}

/** Chi tiết một session: runtime nguồn, trạng thái, query, transaction, lock đang chờ/giữ + thao tác. */
export const SessionDrawer: React.FC<SessionDrawerProps> = ({ id, canCancel, canTerminate, onClose, onCancel, onTerminate, navigate }) => {
  const { t } = useLocale();
  const [data, setData] = useState<DbConnectionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    databaseApi
      .connection(id)
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const s = data?.session;
  const rows: [string, React.ReactNode][] = s
    ? [
        [t('db.session.user'), s.user ?? NO_VALUE],
        [t('db.session.source'), s.runtime ? t(`rt.name.${s.runtime}`) : (s.program ?? t('db.session.external'))],
        [t('db.session.program'), s.program ?? NO_VALUE],
        [t('db.session.database'), s.database ?? NO_VALUE],
        [t('db.session.client'), s.client ?? NO_VALUE],
        [t('db.session.command'), s.command ?? NO_VALUE],
        [t('db.session.connectedFor'), s.connectedSec === null ? t('db.session.notProvided') : formatDuration(s.connectedSec * 1000)],
        [t('db.session.time'), formatDuration(s.queryMs)],
        [t('db.session.txAge'), s.transactionSec === null ? NO_VALUE : formatDuration(s.transactionSec * 1000)],
      ]
    : [];

  return (
    <DbDrawer
      title={t('db.session.title', { id })}
      meta={s ? <span className={`pf-chip ov-tone-${SESSION_TONE[s.state] ?? 'unknown'}`}>{t(`db.session.status.${s.state}`)}</span> : null}
      onClose={onClose}
    >
      {error && <p className="scp-alert scp-alert-danger">{error}</p>}
      {!data && !error && <p className="ov-empty-line">{t('common.loading')}</p>}
      {s && (
        <>
          <div className="tr-drawer-actions">
            {canCancel && s.query && !s.isSelf && (
              <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" disabled={!data.actionsEnabled} onClick={() => onCancel(s)}>
                <OctagonX size={13} /> {t('db.action.cancel')}
              </button>
            )}
            {canTerminate && !s.isSelf && (
              <button type="button" className="scp-btn scp-btn-sm scp-btn-danger" disabled={!data.actionsEnabled} onClick={() => onTerminate(s)}>
                <Unplug size={13} /> {t('db.action.terminate')}
              </button>
            )}
            {s.runtime && (
              <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate(`runtimes/${s.runtime}`)}>
                {t('db.session.openRuntime')}
              </button>
            )}
          </div>
          {!data.actionsEnabled && <p className="tr-note">{t('db.action.disabled')}</p>}
          <table className="scp-table tr-kv-table">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h4 className="pf-drawer-h">{t('db.session.query')}</h4>
          <pre className="tr-code-block db-sql-block">{s.query ?? t('db.session.noQuery')}</pre>
          {data.transaction && (
            <>
              <h4 className="pf-drawer-h">{t('db.tx.title')}</h4>
              <p>{t('db.tx.summary', { age: formatDuration(data.transaction.ageSec * 1000), locks: data.transaction.locksHeld ?? NO_VALUE, isolation: data.transaction.isolation ?? NO_VALUE })}</p>
            </>
          )}
          {data.waits.length > 0 && (
            <>
              <h4 className="pf-drawer-h">{t('db.locks.title')}</h4>
              <ul className="pf-drawer-list">
                {data.waits.map((w) => (
                  <li key={`${w.waitingSession}-${w.blockingSession}`} className="ov-tone-warn">
                    {w.waitingSession === id
                      ? t('db.locks.waitsFor', { id: w.blockingSession, object: w.object ?? NO_VALUE })
                      : t('db.locks.blocks', { id: w.waitingSession, object: w.object ?? NO_VALUE })}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </DbDrawer>
  );
};

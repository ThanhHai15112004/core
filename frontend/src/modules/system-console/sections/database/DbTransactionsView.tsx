import React from 'react';
import { CheckCircle2, FileText } from 'lucide-react';
import type { DbTab } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { usePolling } from '../../hooks/usePolling';
import { BlockingTree } from '../../components/database/BlockingTree';
import { SectionState } from '../../components/database/SectionState';
import { formatDuration } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** Transaction đang mở (highlight transaction dài), chuỗi chặn lock, deadlock mà app gặp phải. */
export const DbTransactionsView: React.FC<{
  paused: boolean;
  driver: string;
  go: (tab: DbTab, id?: string | null) => void;
  navigate: (path: string) => void;
}> = ({ paused, driver, go, navigate }) => {
  const { t, formatTime } = useLocale();
  const { data, reload } = usePolling(() => databaseApi.transactions(), 'tx', undefined, paused);
  const longSec = data?.longTransactionSec ?? 10;
  return (
    <>
      {data && (
        <div className="ov-kpi-grid">
          {[
            ['active', data.stats.active ?? NO_VALUE],
            ['longest', data.stats.longestSec === null ? NO_VALUE : formatDuration(data.stats.longestSec * 1000)],
            ['committedPerMin', data.stats.committedPerMin ?? NO_VALUE],
            ['rolledBackPerMin', data.stats.rolledBackPerMin ?? NO_VALUE],
            ['avgDuration', formatDuration(data.stats.avgDurationMs)],
            ['deadlocksToday', data.deadlocks.today],
          ].map(([key, value]) => (
            <div key={String(key)} className={`ov-card ov-kpi ov-tone-${key === 'longest' && (data.stats.longestSec ?? 0) >= longSec ? 'warn' : 'unknown'}`}>
              <span className="ov-kpi-label">{t(`db.tx.${key}`)}</span>
              <span className="ov-kpi-value">{value}</span>
            </div>
          ))}
        </div>
      )}
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('db.tx.list')}</h3>
          <span className="ov-section-hint">{t('db.tx.hint', { sec: longSec })}</span>
        </header>
        <SectionState section={data?.transactions} driver={driver} onRetry={() => void reload()}>
          {(list) =>
            list.length === 0 ? (
              <p className="pf-ok-line">
                <CheckCircle2 size={16} /> {t('db.tx.none')}
              </p>
            ) : (
              <div className="scp-table-wrap">
                <table className="scp-table">
                  <thead>
                    <tr>
                      <th>{t('db.session.id')}</th>
                      <th>{t('db.session.source')}</th>
                      <th>{t('db.tx.age')}</th>
                      <th>{t('db.tx.locks')}</th>
                      <th>{t('db.tx.isolation')}</th>
                      <th>{t('db.session.query')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((x) => (
                      <tr
                        key={x.id}
                        className={`is-clickable ${x.ageSec >= longSec ? 'db-row-warn' : ''}`}
                        onClick={() => x.sessionId && go('connections', x.sessionId)}
                      >
                        <td>
                          <code>#{x.sessionId ?? NO_VALUE}</code>
                        </td>
                        <td>{x.runtime ? t(`rt.name.${x.runtime}`) : t('db.session.external')}</td>
                        <td>
                          {formatDuration(x.ageSec * 1000)}
                          {x.ageSec >= longSec && <span className="pf-chip ov-tone-warn">{t('db.tx.long')}</span>}
                        </td>
                        <td>{x.locksHeld ?? NO_VALUE}</td>
                        <td>{x.isolation ?? NO_VALUE}</td>
                        <td className="db-sql-cell">
                          <code>{x.query ?? t('db.tx.idle')}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </SectionState>
      </section>
      <div className="ov-split">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('db.locks.title')}</h3>
          </header>
          <SectionState section={data?.lockWaits} driver={driver}>
            {(waits) =>
              waits.length === 0 ? (
                <p className="pf-ok-line">
                  <CheckCircle2 size={16} /> {t('db.locks.none')}
                </p>
              ) : (
                <BlockingTree nodes={data?.blockingChains ?? []} onOpen={(id) => go('connections', id)} />
              )
            }
          </SectionState>
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('db.deadlocks.title')}</h3>
            <span className="ov-section-hint">
              {t('db.deadlocks.counts', {
                today: data?.deadlocks.today ?? 0,
                day: data?.deadlocks.last24h ?? 0,
              })}
            </span>
          </header>
          {data && data.deadlocks.recent.length === 0 ? (
            <p className="pf-ok-line">
              <CheckCircle2 size={16} /> {t('db.deadlocks.none')}
            </p>
          ) : (
            <ul className="pf-drawer-list">
              {data?.deadlocks.recent.map((d) => (
                <li key={`${d.at}-${d.sql}`} className="ov-tone-warn">
                  <strong>
                    {formatTime(Date.parse(d.at), true)} · {d.runtime ? t(`rt.name.${d.runtime}`) : NO_VALUE}
                  </strong>
                  <code>{d.sql}</code>
                  <span>{t('db.deadlocks.resolved')}</span>
                  {d.correlationId && (
                    <button
                      type="button"
                      className="ov-link"
                      onClick={() => navigate(`logs?runtime=${d.runtime ?? 'api'}&correlationId=${encodeURIComponent(d.correlationId!)}`)}
                    >
                      <FileText size={12} /> {t('db.query.openLogs')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="pf-chart-note">{t('db.deadlocks.note')}</p>
        </section>
      </div>
    </>
  );
};

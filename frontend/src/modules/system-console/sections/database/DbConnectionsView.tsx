import React from 'react';
import type { DbTab } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { usePolling } from '../../hooks/usePolling';
import { SessionTable } from '../../components/database/SessionTable';
import { SectionState } from '../../components/database/SectionState';
import { NO_VALUE } from '../../utils/runtime-format';
import type { useSessionActions } from '../../hooks/useSessionActions';
import { useLocale } from '../../../../core/i18n/index';

interface Props {
  paused: boolean;
  driver: string;
  slowMs: number;
  canCancel: boolean;
  canTerminate: boolean;
  runtimeFilter: string | undefined;
  setQuery: (patch: Record<string, string | number | undefined>) => void;
  go: (tab: DbTab, id?: string | null) => void;
  actions: ReturnType<typeof useSessionActions>;
  reloadKey: number;
}

/** Pool của app + session theo runtime (API/Worker/Scheduler/CLI) — bấm runtime để lọc, bấm session để xem chi tiết. */
export const DbConnectionsView: React.FC<Props> = ({ paused, driver, slowMs, canCancel, canTerminate, runtimeFilter, setQuery, go, actions, reloadKey }) => {
  const { t } = useLocale();
  const { data, reload } = usePolling(() => databaseApi.connections(), `conn:${reloadKey}`, undefined, paused);
  const total = data?.byRuntime.reduce((a, r) => a + r.count, 0) ?? 0;
  const label = (runtime: string) => (runtime === 'other' ? t('db.session.external') : t(`rt.name.${runtime}`));

  return (
    <>
      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('db.pool.title')}</h3>
          </header>
          {data && (
            <dl className="db-stat-grid db-stat-compact">
              <div>
                <dt>{t('db.pool.inUse')}</dt>
                <dd>{data.pool.used === null ? NO_VALUE : `${Math.round(data.pool.used)} / ${data.pool.limit}`}</dd>
              </div>
              <div>
                <dt>{t('db.pool.idle')}</dt>
                <dd>{data.pool.idle === null ? NO_VALUE : Math.round(data.pool.idle)}</dd>
              </div>
              <div>
                <dt>{t('db.pool.waiting')}</dt>
                <dd>{data.pool.waiting ?? NO_VALUE}</dd>
              </div>
              <div>
                <dt>{t('db.pool.peakToday')}</dt>
                <dd>{data.pool.peakToday ?? NO_VALUE}</dd>
              </div>
              <div>
                <dt>{t('db.pool.serverMax')}</dt>
                <dd>{data.maxConnections ?? NO_VALUE}</dd>
              </div>
            </dl>
          )}
          <p className="pf-chart-note">{t('db.pool.scopeNote')}</p>
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('db.conn.byRuntime')}</h3>
            {runtimeFilter && (
              <button type="button" className="ov-link" onClick={() => setQuery({ runtime: undefined })}>
                {t('db.conn.clearFilter')}
              </button>
            )}
          </header>
          {data && data.byRuntime.length === 0 && <p className="ov-empty-line">{t('db.conn.empty')}</p>}
          <ul className="db-runtime-bars">
            {data?.byRuntime.map((r) => (
              <li key={r.runtime}>
                <button
                  type="button"
                  className={runtimeFilter === r.runtime ? 'is-active' : ''}
                  onClick={() =>
                    setQuery({
                      runtime: runtimeFilter === r.runtime ? undefined : r.runtime,
                    })
                  }
                >
                  <span className="rt-resource-label">
                    {label(r.runtime)} <b>{r.count}</b>
                    <small>{t('db.conn.active', { count: r.active })}</small>
                  </span>
                  <span className="rt-bar">
                    <span
                      style={{
                        width: `${total ? (r.count / total) * 100 : 0}%`,
                      }}
                    />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('db.conn.title')}</h3>
          <span className="ov-section-hint">{t('db.conn.hint')}</span>
        </header>
        <SectionState section={data?.sessions} driver={driver} onRetry={() => void reload()}>
          {(list) => (
            <SessionTable
              sessions={list.filter((s) => !runtimeFilter || (s.runtime ?? 'other') === runtimeFilter)}
              slowMs={slowMs}
              mode="connections"
              actionsEnabled={data?.actionsEnabled ?? false}
              canCancel={canCancel}
              canTerminate={canTerminate}
              onOpen={(s) => go('connections', s.id)}
              onCancel={actions.requestCancel}
              onTerminate={actions.requestTerminate}
              emptyText={t('db.conn.empty')}
            />
          )}
        </SectionState>
      </section>
    </>
  );
};

import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { DbRange, DbTab } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { usePolling } from '../../hooks/usePolling';
import { SLOW_THRESHOLDS } from '../../constants/database';
import { SessionTable } from '../../components/database/SessionTable';
import { SectionState } from '../../components/database/SectionState';
import { formatCompact, formatDuration } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import type { useSessionActions } from '../../hooks/useSessionActions';
import { useLocale } from '../../../../core/i18n/index';

interface Props {
  range: DbRange;
  paused: boolean;
  driver: string;
  canCancel: boolean;
  minMs: number;
  stateFilter: string;
  setQuery: (patch: Record<string, string | number | undefined>) => void;
  go: (tab: DbTab, id?: string | null) => void;
  actions: ReturnType<typeof useSessionActions>;
  reloadKey: number;
}

const STATE_FILTERS = ['all', 'running', 'slow', 'blocked'] as const;

/** Query đang chạy (live, lọc running/slow/blocked, Cancel) + thống kê theo dạng câu (digest) có ngưỡng chậm. */
export const DbQueriesView: React.FC<Props> = ({ range, paused, driver, canCancel, minMs, stateFilter, setQuery, go, actions, reloadKey }) => {
  const { t, locale, formatRelative } = useLocale();
  const live = usePolling(() => databaseApi.liveQueries(), `live:${reloadKey}`, undefined, paused);
  const stats = usePolling(() => databaseApi.queryStats(range, minMs), `stats:${range}:${minMs}`, 30_000, paused);
  const now = Date.now();
  const slowMs = live.data?.slowQueryMs ?? 500;

  return (
    <>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('db.live.title')}</h3>
          <div className="ov-segmented" role="tablist" aria-label={t('db.live.filter')}>
            {STATE_FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={stateFilter === f}
                className={stateFilter === f ? 'is-active' : ''}
                onClick={() => setQuery({ state: f === 'all' ? undefined : f })}
              >
                {t(`db.live.state.${f}`)}
              </button>
            ))}
          </div>
        </header>
        <SectionState section={live.data?.sessions} driver={driver} onRetry={() => void live.reload()}>
          {(list) => {
            const filtered = list.filter((s) =>
              stateFilter === 'running'
                ? s.state === 'active'
                : stateFilter === 'slow'
                  ? (s.queryMs ?? 0) >= slowMs
                  : stateFilter === 'blocked'
                    ? s.state === 'blocked'
                    : true,
            );
            return (
              <SessionTable
                sessions={filtered}
                slowMs={slowMs}
                mode="queries"
                actionsEnabled={live.data?.actionsEnabled ?? false}
                canCancel={canCancel}
                canTerminate={false}
                onOpen={(s) => go('connections', s.id)}
                onCancel={actions.requestCancel}
                emptyText={t('db.live.empty')}
              />
            );
          }}
        </SectionState>
      </section>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('db.stats.title')}</h3>
          <div className="ov-segmented" role="tablist" aria-label={t('db.stats.threshold')}>
            {SLOW_THRESHOLDS.map((ms) => (
              <button
                key={ms}
                type="button"
                role="tab"
                aria-selected={minMs === ms}
                className={minMs === ms ? 'is-active' : ''}
                onClick={() => setQuery({ minMs: ms || undefined })}
              >
                {ms === 0 ? t('db.stats.all') : `>${formatDuration(ms)}`}
              </button>
            ))}
          </div>
        </header>
        <SectionState section={stats.data?.stats} driver={driver} onRetry={() => void stats.reload()}>
          {(list) =>
            list.length === 0 ? (
              <p className="pf-ok-line">
                <CheckCircle2 size={16} />{' '}
                {minMs > 0
                  ? t('db.stats.noSlow', {
                      ms: formatDuration(minMs),
                      range: t(`tr.range.${range}`),
                    })
                  : t('db.stats.empty')}
              </p>
            ) : (
              <div className="scp-table-wrap">
                <table className="scp-table db-stats-table">
                  <thead>
                    <tr>
                      <th>{t('db.stats.query')}</th>
                      <th>{t('db.query.avg')}</th>
                      <th>{t('db.query.max')}</th>
                      <th>{t('db.query.calls')}</th>
                      <th>{t('db.stats.rangeCalls')}</th>
                      <th>{t('db.query.noIndex')}</th>
                      <th>{t('db.query.lastSeen')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((q) => (
                      <tr key={q.id} className="is-clickable" onClick={() => go('queries', q.id)}>
                        <td className="db-sql-cell">
                          <code>{q.sql}</code>
                          {q.slow && <span className="pf-chip ov-tone-warn">{t('db.query.slow')}</span>}
                        </td>
                        <td>
                          {q.timingReliable ? formatDuration(q.avgMs) : <span title={t('db.query.unreliableNote')}>{t('db.query.unreliableShort')}</span>}
                        </td>
                        <td>{q.timingReliable ? formatDuration(q.maxMs) : NO_VALUE}</td>
                        <td>{formatCompact(q.calls, locale)}</td>
                        <td>{q.rangeCalls === null ? NO_VALUE : formatCompact(q.rangeCalls, locale)}</td>
                        <td>{q.noIndexUsed ? formatCompact(q.noIndexUsed, locale) : NO_VALUE}</td>
                        <td>{q.lastSeen ? formatRelative(new Date(q.lastSeen), now) : NO_VALUE}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </SectionState>
        <p className="pf-chart-note">{t('db.stats.note')}</p>
      </section>
    </>
  );
};

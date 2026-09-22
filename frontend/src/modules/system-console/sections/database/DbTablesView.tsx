import React, { useState } from 'react';
import type { DbTab, DbTable } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { usePolling } from '../../hooks/usePolling';
import { SectionState } from '../../components/database/SectionState';
import { LineChart } from '../../components/common/LineChart';
import { formatBytes, formatCompact, formatSignedBytes } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

const SORTS = ['size', 'rows', 'reads', 'writes', 'growth'] as const;
type Sort = (typeof SORTS)[number];
const sortValue = (t: DbTable, s: Sort) =>
  s === 'size'
    ? (t.totalBytes ?? -1)
    : s === 'rows'
      ? (t.rows ?? -1)
      : s === 'reads'
        ? (t.readsPerSec ?? -1)
        : s === 'writes'
          ? (t.writesPerSec ?? -1)
          : (t.growthPercent ?? -Infinity);

/** Bảng (sort theo kích thước/dòng/đọc/ghi/tăng trưởng) + dung lượng database và lịch sử tăng trưởng. */
export const DbTablesView: React.FC<{
  paused: boolean;
  driver: string;
  go: (tab: DbTab, id?: string | null) => void;
}> = ({ paused, driver, go }) => {
  const { t, locale } = useLocale();
  const [sort, setSort] = useState<Sort>('size');
  const tables = usePolling(() => databaseApi.tables(), 'tables', 30_000, paused);
  const storage = usePolling(() => databaseApi.storage(), 'storage', 60_000, paused);
  const st = storage.data;

  return (
    <>
      <div className="ov-split">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('db.storage.title')}</h3>
            <span className="ov-section-hint">{t('db.storage.hint')}</span>
          </header>
          {st && (
            <SectionState section={st.storage} driver={driver}>
              {(s) => (
                <>
                  <dl className="db-stat-grid">
                    <div>
                      <dt>{t('db.storage.total')}</dt>
                      <dd>{formatBytes(s.totalBytes)}</dd>
                    </div>
                    <div>
                      <dt>{t('db.table.data')}</dt>
                      <dd>{formatBytes(s.dataBytes)}</dd>
                    </div>
                    <div>
                      <dt>{t('db.table.indexes')}</dt>
                      <dd>{formatBytes(s.indexBytes)}</dd>
                    </div>
                    <div>
                      <dt>{t('db.storage.tables')}</dt>
                      <dd>{s.tables}</dd>
                    </div>
                    <div>
                      <dt>{t('db.storage.growthToday')}</dt>
                      <dd>{formatSignedBytes(st.growthTodayBytes)}</dd>
                    </div>
                    <div>
                      <dt>{t('db.storage.growth30d')}</dt>
                      <dd>{formatSignedBytes(st.growth30dBytes)}</dd>
                    </div>
                  </dl>
                  {st.limitBytes ? (
                    <div className="db-capacity">
                      <span className="rt-resource-label">
                        {t('db.storage.capacity')}{' '}
                        <b>
                          {formatBytes(s.totalBytes)} / {formatBytes(st.limitBytes)} · {st.percent}%
                        </b>
                      </span>
                      <span className={`rt-bar ${(st.percent ?? 0) >= 80 ? 'is-high' : ''}`}>
                        <span
                          style={{
                            width: `${Math.min(100, st.percent ?? 0)}%`,
                          }}
                        />
                      </span>
                    </div>
                  ) : (
                    <p className="pf-chart-note">{t('db.storage.noLimit')}</p>
                  )}
                </>
              )}
            </SectionState>
          )}
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('db.storage.growthChart')}</h3>
          </header>
          <LineChart
            series={[
              {
                id: 'size',
                label: t('db.storage.total'),
                color: 'var(--scp-series-1)',
                points: (st?.history ?? []).map((p) => ({
                  t: p.t,
                  value: Math.round((p.value / 1024 / 1024) * 100) / 100,
                })),
              },
            ]}
            unit="MB"
            height={180}
            formatTime={(ts) => new Date(ts).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            emptyText={t('db.storage.noHistory')}
            ariaLabel={t('db.storage.growthChart')}
          />
          <p className="pf-chart-note">{t('db.storage.historyNote')}</p>
        </section>
      </div>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('db.tables.title')}</h3>
          <div className="ov-segmented" role="tablist" aria-label={t('db.tables.sort')}>
            {SORTS.map((s) => (
              <button key={s} type="button" role="tab" aria-selected={sort === s} className={sort === s ? 'is-active' : ''} onClick={() => setSort(s)}>
                {t(`db.tables.sortBy.${s}`)}
              </button>
            ))}
          </div>
        </header>
        <SectionState section={tables.data?.tables} driver={driver} onRetry={() => void tables.reload()}>
          {(list) =>
            list.length === 0 ? (
              <p className="ov-empty-line">{t('db.tables.empty')}</p>
            ) : (
              <div className="scp-table-wrap">
                <table className="scp-table">
                  <thead>
                    <tr>
                      <th>{t('db.table.name')}</th>
                      <th>{t('db.table.rows')}</th>
                      <th>{t('db.table.data')}</th>
                      <th>{t('db.table.indexes')}</th>
                      <th>{t('db.table.total')}</th>
                      <th>{t('db.table.readsPerSec')}</th>
                      <th>{t('db.table.writesPerSec')}</th>
                      <th>{t('db.table.growth')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...list]
                      .sort((a, b) => sortValue(b, sort) - sortValue(a, sort))
                      .map((tb) => (
                        <tr key={tb.name} className="is-clickable" onClick={() => go('tables', tb.name)}>
                          <td>
                            <code>{tb.name}</code>
                          </td>
                          <td>{formatCompact(tb.rows, locale)}</td>
                          <td>{formatBytes(tb.dataBytes)}</td>
                          <td>{formatBytes(tb.indexBytes)}</td>
                          <td>{formatBytes(tb.totalBytes)}</td>
                          <td>{tb.readsPerSec ?? NO_VALUE}</td>
                          <td>{tb.writesPerSec ?? NO_VALUE}</td>
                          <td>{tb.growthPercent === null ? NO_VALUE : `${tb.growthPercent > 0 ? '+' : ''}${tb.growthPercent}%`}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )
          }
        </SectionState>
        <p className="pf-chart-note">{t('db.tables.note')}</p>
      </section>
    </>
  );
};

import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { DbOverview, DbReport, DbTab } from '../../types/database.types';
import { DbKpis } from '../../components/database/DbKpis';
import { DbChart } from '../../components/database/DbChart';
import { DbAlerts } from '../../components/database/DbAlerts';
import { DbEventList } from '../../components/database/DbEventList';
import { SessionTable } from '../../components/database/SessionTable';
import { SectionState } from '../../components/database/SectionState';
import { formatBytes, formatCompact, formatDuration, formatSignedBytes } from '../../utils/database-format';
import { formatUnit, trendOf } from '../../utils/performance-format';
import { NO_VALUE } from '../../utils/runtime-format';
import type { useSessionActions } from '../../hooks/useSessionActions';
import { useLocale } from '../../../../core/i18n/index';

interface Props {
  data: DbOverview | null;
  now: number;
  paused: boolean;
  go: (tab: DbTab, id?: string | null) => void;
  actions: ReturnType<typeof useSessionActions>;
}

const pct = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : ((a - b) / b) * 100);

/** Tổng quan: KPI → biểu đồ → vấn đề → query đang chạy → pool & transaction → bảng lớn → báo cáo hôm nay → sự kiện. */
export const DbOverviewView: React.FC<Props> = ({ data, now, paused, go, actions }) => {
  const { t, locale } = useLocale();
  const reportRow = (key: keyof DbReport, fmt: (v: number | null) => string, higherIsWorse: boolean | null) => {
    if (!data) return null;
    const today = data.report.today[key];
    const yesterday = data.report.yesterday[key];
    const trend = key === 'growthBytes' ? null : trendOf(pct(today, yesterday), higherIsWorse);
    return (
      <tr key={key}>
        <th>{t(`db.report.${key}`)}</th>
        <td>{fmt(today)}</td>
        <td>{fmt(yesterday)}</td>
        <td>{trend ? <span className={`ov-kpi-trend is-${trend.tone}`}>{trend.text}</span> : NO_VALUE}</td>
      </tr>
    );
  };
  return (
    <>
      <DbKpis data={data} />
      <DbChart range={data?.range ?? '1h'} paused={paused} />
      {data && (
        <>
          <div className="ov-split">
            <section className="ov-card ov-section">
              <header className="ov-section-head">
                <h3>{t('db.live.title')}</h3>
                <span className="ov-section-hint">{t('db.live.hint', { ms: data.settings.slowQueryMs })}</span>
              </header>
              <SectionState section={data.liveQueries} driver={data.driver}>
                {(list) => (
                  <SessionTable
                    sessions={list}
                    slowMs={data.settings.slowQueryMs}
                    mode="queries"
                    actionsEnabled={data.settings.actionsEnabled}
                    canCancel={data.capabilities.includes('cancel')}
                    canTerminate={false}
                    onOpen={(s) => go('connections', s.id)}
                    onCancel={actions.requestCancel}
                    emptyText={t('db.live.empty')}
                  />
                )}
              </SectionState>
              <footer className="ov-section-foot">
                <button type="button" className="ov-link" onClick={() => go('queries')}>
                  {t('db.live.viewAll')} <ArrowRight size={13} />
                </button>
              </footer>
            </section>
            <DbAlerts data={data} now={now} onOpen={(tab) => go(tab)} />
          </div>

          <div className="ov-split db-split-even">
            <section className="ov-card ov-section">
              <header className="ov-section-head">
                <h3>{t('db.pool.title')}</h3>
                <button type="button" className="ov-link" onClick={() => go('connections')}>
                  {t('db.pool.view')} <ArrowRight size={13} />
                </button>
              </header>
              <p className="db-pool-big">
                {data.pool.used === null ? NO_VALUE : Math.round(data.pool.used)} <small>/ {data.pool.limit}</small>
              </p>
              <span className={`rt-bar ${data.pool.percent === null ? 'is-empty' : data.pool.percent >= 85 ? 'is-high' : ''}`}>
                {data.pool.percent !== null && <span style={{ width: `${Math.min(100, data.pool.percent)}%` }} />}
              </span>
              <dl className="db-stat-grid db-stat-compact">
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
                  <dt>{t('db.pool.sessions')}</dt>
                  <dd>{data.kpis.sessions ?? NO_VALUE}</dd>
                </div>
              </dl>
              <p className="pf-chart-note">{t('db.pool.note', { runtimes: data.runtimes.length })}</p>
            </section>
            <section className="ov-card ov-section">
              <header className="ov-section-head">
                <h3>{t('db.tx.title')}</h3>
                <button type="button" className="ov-link" onClick={() => go('transactions')}>
                  {t('db.tx.view')} <ArrowRight size={13} />
                </button>
              </header>
              <dl className="db-stat-grid db-stat-compact">
                <div>
                  <dt>{t('db.tx.active')}</dt>
                  <dd>{data.transactions.active ?? NO_VALUE}</dd>
                </div>
                <div>
                  <dt>{t('db.tx.longest')}</dt>
                  <dd className={(data.transactions.longestSec ?? 0) >= data.settings.longTransactionSec ? 'is-warn' : ''}>
                    {data.transactions.longestSec === null ? NO_VALUE : formatDuration(data.transactions.longestSec * 1000)}
                  </dd>
                </div>
                <div>
                  <dt>{t('db.tx.committedPerMin')}</dt>
                  <dd>{data.transactions.committedPerMin ?? NO_VALUE}</dd>
                </div>
                <div>
                  <dt>{t('db.tx.rolledBackPerMin')}</dt>
                  <dd>{data.transactions.rolledBackPerMin ?? NO_VALUE}</dd>
                </div>
                <div>
                  <dt>{t('db.kpi.deadlocks')}</dt>
                  <dd>{data.kpis.deadlocks24h}</dd>
                </div>
                <div>
                  <dt>{t('db.tx.lockWaits')}</dt>
                  <dd>{data.kpis.lockWaits ?? NO_VALUE}</dd>
                </div>
              </dl>
            </section>
          </div>

          <div className="ov-split db-split-even">
            <section className="ov-card ov-section">
              <header className="ov-section-head">
                <h3>{t('db.tables.largest')}</h3>
                <button type="button" className="ov-link" onClick={() => go('tables')}>
                  {t('db.tables.viewAll')} <ArrowRight size={13} />
                </button>
              </header>
              <SectionState section={data.largestTables} driver={data.driver}>
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
                            <th>{t('db.table.total')}</th>
                            <th>{t('db.table.growth')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {list.map((tb) => (
                            <tr key={tb.name} className="is-clickable" onClick={() => go('tables', tb.name)}>
                              <td>
                                <code>{tb.name}</code>
                              </td>
                              <td>{formatCompact(tb.rows, locale)}</td>
                              <td>{formatBytes(tb.totalBytes)}</td>
                              <td>{tb.growthPercent === null ? NO_VALUE : `${tb.growthPercent > 0 ? '+' : ''}${tb.growthPercent}%`}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                }
              </SectionState>
            </section>
            <section className="ov-card ov-section">
              <header className="ov-section-head">
                <h3>{t('db.report.title')}</h3>
                <span className="ov-section-hint">{t('db.report.hint')}</span>
              </header>
              <div className="scp-table-wrap">
                <table className="scp-table tr-kv-table db-report">
                  <thead>
                    <tr>
                      <th />
                      <th>{t('db.report.today')}</th>
                      <th>{t('db.report.yesterday')}</th>
                      <th>{t('db.report.change')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportRow('queries', (v) => formatCompact(v, locale), null)}
                    {reportRow('avgMs', (v) => formatUnit(v, 'ms'), true)}
                    {reportRow('p95Ms', (v) => formatUnit(v, 'ms'), true)}
                    {reportRow('slowQueries', (v) => String(v ?? NO_VALUE), true)}
                    {reportRow('failedQueries', (v) => String(v ?? NO_VALUE), true)}
                    {reportRow('peakConnections', (v) => (v === null ? NO_VALUE : String(Math.round(v))), null)}
                    {reportRow('deadlocks', (v) => String(v ?? NO_VALUE), true)}
                    {reportRow('growthBytes', formatSignedBytes, null)}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section className="ov-card ov-section">
            <header className="ov-section-head">
              <h3>{t('db.events.title')}</h3>
              <button type="button" className="ov-link" onClick={() => go('errors')}>
                {t('db.events.viewAll')} <ArrowRight size={13} />
              </button>
            </header>
            <DbEventList events={data.events} onOpen={(tab) => go(tab)} emptyText={t('db.events.empty')} />
          </section>
        </>
      )}
    </>
  );
};

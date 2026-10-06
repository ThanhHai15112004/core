import React, { useEffect, useState } from 'react';
import { Check, Copy, FileText } from 'lucide-react';
import type { DbExplain, DbQueryDetail, DbRange } from '../../types/database.types';
import { databaseApi } from '../../services/database.api';
import { formatCompact, formatDuration } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { DbDrawer } from './DbDrawer';
import { ExplainPlan } from './ExplainPlan';
import { useLocale } from '../../../../core/i18n/index';

const TABS = ['summary', 'plan'] as const;
type Tab = (typeof TABS)[number];

/** Chi tiết một câu query (theo digest): thống kê cộng dồn của DB, SQL chuẩn hoá, execution plan; slow query ở Logs. */
export const QueryDrawer: React.FC<{ id: string; range: DbRange; onClose: () => void; navigate: (path: string) => void }> = ({ id, range, onClose, navigate }) => {
  const { t, locale, formatTime } = useLocale();
  const [tab, setTab] = useState<Tab>('summary');
  const [data, setData] = useState<DbQueryDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explain, setExplain] = useState<DbExplain | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    databaseApi
      .queryDetail(id, range)
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [id, range]);

  useEffect(() => {
    if (tab !== 'plan' || explain) return;
    databaseApi
      .explain(id)
      .then(setExplain)
      .catch((e: unknown) => setExplain({ available: false, reason: e instanceof Error ? e.message : String(e), plan: null }));
  }, [tab, id, explain]);

  const s = data?.stat;
  const copy = () => {
    if (!s) return;
    void navigator.clipboard?.writeText(s.sql);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const ms = (v: number | null) => (s && !s.timingReliable ? t('db.query.unreliable') : formatDuration(v));

  return (
    <DbDrawer
      title={t('db.query.title')}
      meta={s ? <span className={`pf-chip ov-tone-${s.slow ? 'warn' : 'ok'}`}>{s.slow ? t('db.query.slow') : t('db.query.normal')}</span> : null}
      onClose={onClose}
    >
      {error && <p className="scp-alert scp-alert-danger">{error}</p>}
      {!data && !error && <p className="ov-empty-line">{t('common.loading')}</p>}
      {s && (
        <>
          <div className="tr-drawer-actions">
            <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={copy}>
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('console.drawer.copied') : t('db.query.copySql')}
            </button>
          </div>
          <nav className="rt-tabs" role="tablist">
            {TABS.map((x) => (
              <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'is-active' : ''} onClick={() => setTab(x)}>
                {t(`db.query.tab.${x}`)}
              </button>
            ))}
          </nav>
          {tab === 'summary' && (
            <>
              <pre className="tr-code-block db-sql-block">{s.sql}</pre>
              {!s.timingReliable && <p className="tr-note">{t('db.query.unreliableNote')}</p>}
              <dl className="db-stat-grid">
                <div><dt>{t('db.query.avg')}</dt><dd>{ms(s.avgMs)}</dd></div>
                <div><dt>{t('db.query.max')}</dt><dd>{ms(s.maxMs)}</dd></div>
                <div><dt>{t('db.query.calls')}</dt><dd>{formatCompact(s.calls, locale)}</dd></div>
                <div><dt>{t('db.query.rowsExamined')}</dt><dd>{formatCompact(s.rowsExamined, locale)}</dd></div>
                <div><dt>{t('db.query.rowsReturned')}</dt><dd>{formatCompact(s.rowsReturned, locale)}</dd></div>
                <div><dt>{t('db.query.noIndex')}</dt><dd>{formatCompact(s.noIndexUsed, locale)}</dd></div>
                <div><dt>{t('db.query.errors')}</dt><dd>{s.errors}</dd></div>
                <div><dt>{t('db.query.lastSeen')}</dt><dd>{s.lastSeen ? `${new Date(s.lastSeen).toLocaleDateString()} ${formatTime(Date.parse(s.lastSeen))}` : NO_VALUE}</dd></div>
              </dl>
              <p className="pf-chart-note">{t('db.query.cumulativeNote')}</p>
              <button type="button" className="ov-link" onClick={() => navigate('logs/explorer?module=TypeORM')}>
                <FileText size={12} /> {t('db.query.openLogs')}
              </button>
            </>
          )}
          {tab === 'plan' && <ExplainPlan explain={explain} />}
        </>
      )}
    </DbDrawer>
  );
};

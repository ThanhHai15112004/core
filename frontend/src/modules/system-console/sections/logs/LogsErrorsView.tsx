import React, { useState } from 'react';
import { ArrowLeft, Briefcase, Database, FileSearch, Search } from 'lucide-react';
import type { LogFilters, LogsRange } from '../../types/logs.types';
import { logsApi } from '../../services/logs.api';
import { usePolling } from '../../hooks/usePolling';
import { ErrorGroupTable, TrendBadge } from '../../components/logs/ErrorGroupTable';
import { LogTable } from '../../components/logs/LogTable';
import { LineChart } from '../../components/common/LineChart';
import { DEPENDENCY_SECTION } from '../../constants/logs';
import { formatCompact } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

interface Common {
  range: LogsRange;
  paused: boolean;
  reloadKey: number;
  now: number;
  navigate: (path: string) => void;
}

/** Error Groups: lỗi gom theo fingerprint (loại lỗi + module + message chuẩn hoá + vị trí stack), không theo chuỗi thô. */
export const LogsErrorsView: React.FC<Common & { openError: (fp: string) => void }> = ({ range, paused, reloadKey, now, openError }) => {
  const { t, locale } = useLocale();
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState('');
  const { data, error } = usePolling(() => logsApi.errors(range, applied || undefined), `logs-errors:${range}:${applied}:${reloadKey}`, undefined, paused);
  const newOnes = data?.items.filter((g) => g.isNew) ?? [];
  const spiking = data?.items.filter((g) => g.spiking) ?? [];
  return (
    <>
      {(newOnes.length > 0 || spiking.length > 0) && (
        <div className="lg-grid-2">
          {spiking.length > 0 && (
            <section className="ov-card ov-section ov-tone-crit lg-callout">
              <h3>{t('logs.groups.spikeTitle')}</h3>
              {spiking.slice(0, 3).map((g) => (
                <button key={g.fingerprint} type="button" className="ov-link" onClick={() => openError(g.fingerprint)}>
                  <strong>{g.errorType ?? g.template}</strong> {g.changePercent !== null && `+${g.changePercent}%`}
                </button>
              ))}
            </section>
          )}
          {newOnes.length > 0 && (
            <section className="ov-card ov-section ov-tone-warn lg-callout">
              <h3>{t('logs.groups.newTitle')}</h3>
              {newOnes.slice(0, 3).map((g) => (
                <button key={g.fingerprint} type="button" className="ov-link" onClick={() => openError(g.fingerprint)}>
                  <strong>{g.errorType ?? g.template}</strong> · {t('logs.groups.occurrences', { count: formatCompact(g.total, locale) })}
                </button>
              ))}
            </section>
          )}
        </div>
      )}
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('logs.groups.title')}</h3>
          <form
            className="lg-search-box lg-search-sm"
            onSubmit={(e) => {
              e.preventDefault();
              setApplied(q.trim());
            }}
          >
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('logs.groups.search')} aria-label={t('logs.groups.search')} />
          </form>
        </header>
        {error && <p className="scp-alert scp-alert-danger">{error.message}</p>}
        {data && data.items.length === 0 ? (
          <p className="ov-empty-line">{t('logs.groups.empty')}</p>
        ) : (
          <ErrorGroupTable rows={data?.items ?? []} onOpen={openError} now={now} />
        )}
        <p className="pf-chart-note">{t('logs.groups.note')}</p>
        {data && data.otherCount > 0 && <p className="pf-chart-note">{t('logs.groups.other', { count: data.otherCount })}</p>}
      </section>
    </>
  );
};

/** Chi tiết nhóm lỗi: số lần, lần đầu / cuối, runtime / job / endpoint bị ảnh hưởng, biểu đồ, mẫu log, tương quan khởi động. */
export const ErrorGroupDetailView: React.FC<
  Common & { fingerprint: string; onBack: () => void; openLog: (id: string) => void; explore: (f: LogFilters) => void }
> = ({ fingerprint, range, paused, reloadKey, now, navigate, onBack, openLog, explore }) => {
  const { t, locale, formatTime, formatRelative } = useLocale();
  const { data, error } = usePolling(() => logsApi.errorGroup(fingerprint, range), `logs-group:${fingerprint}:${range}:${reloadKey}`, undefined, paused);
  const n = (v: number | null) => formatCompact(v, locale);
  return (
    <>
      <button type="button" className="ov-link job-back" onClick={onBack}>
        <ArrowLeft size={14} /> {t('logs.groups.back')}
      </button>
      {error && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {!data && !error && <p className="ov-empty-line">{t('common.loading')}</p>}
      {data && (
        <>
          <section className="ov-card ov-section">
            <header className="ov-section-head">
              <div>
                <h3 className="lg-group-title">
                  {data.errorType ?? t('logs.groups.untyped')} <TrendBadge g={data} />
                </h3>
                <p className="lg-group-template">{data.template}</p>
                {(data.module || data.frame) && (
                  <p className="lg-note">
                    {data.module}
                    {data.frame ? ` · ${data.frame}` : ''}
                  </p>
                )}
              </div>
              <div className="tr-drawer-actions">
                <button type="button" className="scp-btn scp-btn-sm scp-btn-primary" onClick={() => explore({ fingerprint: data.fingerprint, window: '7d' })}>
                  <FileSearch size={13} /> {t('logs.groups.viewLogs')}
                </button>
                {data.jobTypes.length > 0 && (
                  <button
                    type="button"
                    className="scp-btn scp-btn-sm scp-btn-secondary"
                    onClick={() => navigate(`jobs/explorer?status=failed${data.errorType ? `&errorType=${encodeURIComponent(data.errorType)}` : ''}`)}
                  >
                    <Briefcase size={13} /> {t('logs.groups.viewJobs')}
                  </button>
                )}
                {data.dependency && (
                  <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate(DEPENDENCY_SECTION[data.dependency!]!)}>
                    <Database size={13} /> {t('logs.detail.openDependency', { name: t(`logs.dependency.${data.dependency}`) })}
                  </button>
                )}
              </div>
            </header>
            <dl className="rt-kv lg-group-kv">
              <div>
                <dt>{t('logs.groups.occurrencesRange')}</dt>
                <dd>{n(data.count)}</dd>
              </div>
              <div>
                <dt>{t('logs.groups.totalTracked')}</dt>
                <dd>{n(data.total)}</dd>
              </div>
              <div>
                <dt>{t('logs.groups.firstSeenLabel')}</dt>
                <dd>{data.firstSeen ? `${formatTime(data.firstSeen, true)} (${formatRelative(data.firstSeen, now)})` : NO_VALUE}</dd>
              </div>
              <div>
                <dt>{t('logs.groups.lastSeenLabel')}</dt>
                <dd>{data.lastSeen ? formatRelative(data.lastSeen, now) : NO_VALUE}</dd>
              </div>
              <div>
                <dt>{t('logs.groups.rate')}</dt>
                <dd>
                  {t('logs.groups.rateValue', { current: data.currentPerMin ?? NO_VALUE, baseline: data.baselinePerMin ?? NO_VALUE })}
                  {data.spiking && <span className="pf-chip ov-tone-crit">{t('logs.trend.spike')}</span>}
                </dd>
              </div>
              {data.nearestStart && (
                <div>
                  <dt>{t('logs.groups.correlation')}</dt>
                  <dd>
                    {t('logs.groups.afterStart', { minutes: data.nearestStart.minutesBefore, runtime: t(`rt.name.${data.nearestStart.runtime}`) })}
                    <small className="pf-row-note">{t('logs.groups.correlationNote')}</small>
                  </dd>
                </div>
              )}
            </dl>
          </section>

          <section className="ov-card ov-section">
            <header className="ov-section-head">
              <h3>{t('logs.groups.overTime')}</h3>
            </header>
            <LineChart
              series={[
                {
                  id: 'n',
                  label: t('logs.groups.count'),
                  color: 'var(--scp-danger)',
                  points: data.series.map((p) => ({ t: Date.parse(p.t), value: p.count })),
                },
              ]}
              unit=""
              formatTime={(v) => formatTime(v)}
              emptyText={t('logs.chart.empty')}
              ariaLabel={t('logs.groups.overTime')}
              height={180}
            />
          </section>

          <div className="lg-grid-3">
            {(['runtimes', 'jobTypes', 'routes'] as const).map((k) => (
              <section key={k} className="ov-card ov-section">
                <header className="ov-section-head">
                  <h3>{t(`logs.groups.affected_${k}`)}</h3>
                </header>
                {data.affected[k].length === 0 ? (
                  <p className="ov-empty-line">{NO_VALUE}</p>
                ) : (
                  <ul className="lg-modules">
                    {data.affected[k].slice(0, 8).map((x) => (
                      <li key={x.name}>
                        <code>{k === 'runtimes' ? t(`rt.name.${x.name}`) : x.name}</code>
                        <span>{n(x.count)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>

          <section className="ov-card ov-section">
            <header className="ov-section-head">
              <h3>{t('logs.groups.samples')}</h3>
              <span className="ov-section-hint">{t('logs.groups.samplesHint')}</span>
            </header>
            {data.samples.length === 0 ? <p className="ov-empty-line">{t('logs.groups.noSamples')}</p> : <LogTable rows={data.samples} onOpen={openLog} />}
          </section>
        </>
      )}
    </>
  );
};

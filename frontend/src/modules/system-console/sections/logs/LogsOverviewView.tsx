import React, { useState } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, ShieldCheck } from 'lucide-react';
import type { LogFilters, LogIssue, LogsOverview, LogsRange, LogsTab } from '../../types/logs.types';
import { logsApi } from '../../services/logs.api';
import { usePolling } from '../../hooks/usePolling';
import { LogVolumeChart, type VolumeMode } from '../../components/logs/LogVolumeChart';
import { ErrorGroupTable } from '../../components/logs/ErrorGroupTable';
import { AuditTable } from '../../components/logs/AuditTable';
import { ShareBar } from '../../components/logs/LogBits';
import { ISSUE_TONE } from '../../constants/logs';
import { formatCompact } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import type { StatusTone } from '../../utils/status-tone';
import { useLocale } from '../../../../core/i18n/index';

const ISSUE_ICON = { ok: CheckCircle2, info: Info, warning: AlertTriangle, critical: AlertOctagon } as const;

interface Props {
  data: LogsOverview | null;
  range: LogsRange;
  paused: boolean;
  reloadKey: number;
  now: number;
  explore: (f: LogFilters) => void;
  openError: (fp: string) => void;
  go: (tab: LogsTab, q?: Record<string, string | undefined>) => void;
  navigate: (path: string) => void;
}

/** Overview: KPI, biểu đồ log theo level (spike), vấn đề hiện tại, nguồn / level / module, nhóm lỗi, audit, báo cáo. */
export const LogsOverviewView: React.FC<Props> = ({ data, range, paused, reloadKey, now, explore, openError, go, navigate }) => {
  const { t, locale, formatTime, formatRelative } = useLocale();
  const [mode, setMode] = useState<VolumeMode>('all');
  const series = usePolling(() => logsApi.series(range), `logs-series:${range}:${reloadKey}`, undefined, paused);
  const report = usePolling(() => logsApi.report(), `logs-report:${reloadKey}`, 60_000, paused);
  const n = (v: number | null | undefined) => formatCompact(v ?? null, locale);
  const k = data?.kpis;

  const kpis: { key: string; value: string; sub: string; tone: StatusTone; onClick?: () => void }[] = k
    ? [
        { key: 'perMin', value: n(k.logsPerMin), sub: t('logs.kpi.perMinSub'), tone: 'unknown', onClick: () => go('explorer') },
        {
          key: 'errors',
          value: n(k.errors),
          sub: t('logs.kpi.errorsSub', { count: n(k.fatal) }),
          tone: (k.errors ?? 0) > 0 ? 'crit' : 'ok',
          onClick: () => explore({ level: 'error,fatal', window: range }),
        },
        {
          key: 'warnings',
          value: n(k.warnings),
          sub: t('logs.kpi.warningsSub'),
          tone: (k.warnings ?? 0) > 0 ? 'warn' : 'ok',
          onClick: () => explore({ level: 'warn', window: range }),
        },
        { key: 'sources', value: String(k.sources), sub: t('logs.kpi.sourcesSub'), tone: 'unknown' },
        {
          key: 'errorRate',
          value: k.errorRatePercent === null ? NO_VALUE : `${k.errorRatePercent}%`,
          sub: t('logs.kpi.errorRateSub'),
          tone: k.errorRatePercent === null ? 'unknown' : k.errorRatePercent >= 5 ? 'warn' : 'ok',
        },
        { key: 'unique', value: String(k.uniqueErrors), sub: t('logs.kpi.uniqueSub'), tone: k.uniqueErrors > 0 ? 'warn' : 'ok', onClick: () => go('errors') },
        { key: 'traceable', value: k.traceablePercent === null ? NO_VALUE : `${k.traceablePercent}%`, sub: t('logs.kpi.traceableSub'), tone: 'unknown' },
        {
          key: 'dropped',
          value: n(k.dropped),
          sub: t('logs.kpi.droppedSub'),
          tone: k.dropped === null ? 'unknown' : k.dropped > 0 ? 'crit' : 'ok',
          onClick: () => go('configuration'),
        },
      ]
    : [];

  const openIssue = (i: LogIssue) => {
    if (!i.target) return;
    if (i.target.kind === 'explorer') explore(i.target.query as LogFilters);
    else if (i.target.kind === 'error') openError(i.target.fingerprint);
    else go('configuration');
  };

  const r = report.data;
  const delta = (cur: number | null, prev: number | null) => {
    if (cur === null || prev === null) return NO_VALUE;
    if (prev === 0) return cur === 0 ? '0%' : t('logs.report.new');
    const p = Math.round(((cur - prev) / prev) * 100);
    return `${p > 0 ? '+' : ''}${p}%`;
  };

  return (
    <>
      <div className="ov-kpi-grid db-kpi-grid">
        {!k
          ? Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="ov-card ov-kpi">
                <span className="ov-skeleton" style={{ width: '60%', height: 12 }} />
                <span className="ov-skeleton" style={{ width: '45%', height: 28, marginTop: 14 }} />
              </div>
            ))
          : kpis.map((x) => (
              <button key={x.key} type="button" className={`ov-card ov-kpi job-kpi ov-tone-${x.tone}`} onClick={x.onClick} disabled={!x.onClick}>
                <span className="ov-kpi-label">{t(`logs.kpi.${x.key}`)}</span>
                <span className="ov-kpi-value">{x.value}</span>
                <span className="ov-kpi-sub">{x.sub}</span>
              </button>
            ))}
      </div>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('logs.chart.title')}</h3>
          <div className="ov-segmented" role="tablist">
            {(['all', 'errors', 'warnings'] as VolumeMode[]).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'is-active' : ''} onClick={() => setMode(m)}>
                {t(`logs.chart.mode.${m}`)}
              </button>
            ))}
          </div>
        </header>
        {series.data?.spike && (
          <p className="scp-alert scp-alert-warning lg-spike">
            <AlertTriangle size={14} />{' '}
            {t('logs.chart.spike', {
              time: formatTime(series.data.spike.at),
              before: series.data.spike.beforePerMin,
              after: series.data.spike.afterPerMin,
            })}
          </p>
        )}
        <LogVolumeChart
          data={series.data}
          mode={mode}
          onPick={(at) => {
            const sec = series.data?.bucketSec ?? 60;
            explore({
              from: at,
              to: new Date(Date.parse(at) + sec * 1000).toISOString(),
              ...(mode === 'errors' ? { level: 'error,fatal' } : mode === 'warnings' ? { level: 'warn' } : {}),
            });
          }}
        />
        <p className="pf-chart-note">{t('logs.chart.note', { sec: series.data?.bucketSec ?? 60 })}</p>
      </section>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('logs.issues.title')}</h3>
        </header>
        {!data ? (
          <p className="ov-empty-line">{t('common.loading')}</p>
        ) : (
          <ul className="lg-issues">
            {data.issues.map((i, idx) => {
              const Icon = ISSUE_ICON[i.severity];
              return (
                <li key={`${i.key}-${idx}`} className={`ov-tone-${ISSUE_TONE[i.severity]}`}>
                  <Icon size={15} />
                  <span>{t(i.key, i.params)}</span>
                  {i.target && (
                    <button type="button" className="ov-link" onClick={() => openIssue(i)}>
                      {t('logs.issues.investigate')}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="lg-grid-2">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('logs.sources.title')}</h3>
            <span className="ov-section-hint">{t(`tr.range.${range}`)}</span>
          </header>
          {data && data.sources.length === 0 ? (
            <p className="ov-empty-line">{t('logs.sources.empty')}</p>
          ) : (
            <table className="scp-table lg-mini-table">
              <thead>
                <tr>
                  <th>{t('logs.sources.source')}</th>
                  <th className="num">{t('logs.sources.perMin')}</th>
                  <th className="num">{t('logs.sources.errors')}</th>
                  <th className="num">{t('logs.sources.warnings')}</th>
                </tr>
              </thead>
              <tbody>
                {data?.sources.map((s) => (
                  <tr key={s.runtime}>
                    <td>
                      <button type="button" className="ov-link" onClick={() => explore({ runtime: s.runtime, window: range })}>
                        {t(`rt.name.${s.runtime}`)}
                      </button>
                      {s.instances > 1 && <small className="pf-row-note">{t('logs.sources.instances', { count: s.instances })}</small>}
                    </td>
                    <td className="num">{n(s.perMin)}</td>
                    <td className="num">
                      {s.errors > 0 ? (
                        <button
                          type="button"
                          className="ov-link lg-err-link"
                          onClick={() => explore({ runtime: s.runtime, level: 'error,fatal', window: range })}
                        >
                          {n(s.errors)}
                        </button>
                      ) : (
                        0
                      )}
                    </td>
                    <td className="num">{n(s.warnings)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('logs.levels.title')}</h3>
          </header>
          <ul className="lg-levels">
            {data?.levels.map((l) => (
              <li key={l.level}>
                <button type="button" className="ov-link" onClick={() => explore({ level: l.level, window: range })}>
                  {l.level.toUpperCase()}
                </button>
                <span className="lg-levels-pct">{l.percent === null ? NO_VALUE : `${l.percent}%`}</span>
                <ShareBar percent={l.percent} tone={l.level === 'error' || l.level === 'fatal' ? 'crit' : l.level === 'warn' ? 'warn' : 'info'} />
                <span className="lg-levels-count">{n(l.count)}</span>
              </li>
            ))}
          </ul>
          {data && data.modules.length > 0 && (
            <>
              <h4 className="lg-sub">{t('logs.modules.title')}</h4>
              <ul className="lg-modules">
                {data.modules.slice(0, 6).map((m) => (
                  <li key={m.module}>
                    <button type="button" className="ov-link" onClick={() => explore({ module: m.module, window: range })}>
                      {m.module === '_none' ? t('logs.modules.none') : m.module === '_other' ? t('logs.modules.other') : m.module}
                    </button>
                    <span>{n(m.total)}</span>
                    {m.errors > 0 && <span className="pf-chip ov-tone-crit">{t('logs.modules.errors', { count: n(m.errors) })}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('logs.groups.title')}</h3>
          <button type="button" className="ov-link" onClick={() => go('errors')}>
            {t('logs.groups.viewAll')}
          </button>
        </header>
        {data && data.topErrors.length === 0 ? (
          <p className="ov-empty-line">{t('logs.groups.empty')}</p>
        ) : (
          <ErrorGroupTable rows={data?.topErrors ?? []} onOpen={openError} now={now} compact />
        )}
      </section>

      <div className="lg-grid-2">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('logs.audit.recent')}</h3>
            <button type="button" className="ov-link" onClick={() => go('audit')}>
              {t('logs.audit.viewAll')}
            </button>
          </header>
          {data && data.recentAudit.length === 0 ? (
            <p className="ov-empty-line">{t('logs.audit.empty')}</p>
          ) : (
            <AuditTable rows={data?.recentAudit ?? []} navigate={navigate} compact />
          )}
        </section>

        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('logs.report.title')}</h3>
            <span className="ov-section-hint">{t('logs.report.hint')}</span>
          </header>
          {!r?.available ? (
            <p className="ov-empty-line">{r ? t('logs.report.unavailable') : t('common.loading')}</p>
          ) : (
            <table className="scp-table lg-mini-table">
              <thead>
                <tr>
                  <th />
                  <th className="num">{t('logs.report.today')}</th>
                  <th className="num">{t('logs.report.vsYesterday')}</th>
                </tr>
              </thead>
              <tbody>
                {(['logs', 'errors', 'warnings', 'fatal'] as const).map((key) => (
                  <tr key={key}>
                    <th>{t(`logs.report.${key}`)}</th>
                    <td className="num">{n(r.current[key])}</td>
                    <td className="num">{delta(r.current[key], r.previous[key])}</td>
                  </tr>
                ))}
                <tr>
                  <th>{t('logs.report.unique')}</th>
                  <td className="num">{r.current.uniqueErrors}</td>
                  <td className="num">{`${r.current.uniqueErrors - r.previous.uniqueErrors >= 0 ? '+' : ''}${r.current.uniqueErrors - r.previous.uniqueErrors}`}</td>
                </tr>
                <tr>
                  <th>{t('logs.report.peak')}</th>
                  <td className="num">{n(r.current.peakPerMin)}</td>
                  <td className="num">{n(r.previous.peakPerMin)}</td>
                </tr>
                <tr>
                  <th>{t('logs.report.topError')}</th>
                  <td colSpan={2}>
                    {r.current.topError ? (
                      <button type="button" className="ov-link" onClick={() => openError(r.current.topError!.fingerprint)}>
                        {r.current.topError.label} ({n(r.current.topError.count)})
                      </button>
                    ) : (
                      NO_VALUE
                    )}
                  </td>
                </tr>
                <tr>
                  <th>{t('logs.report.topSource')}</th>
                  <td colSpan={2}>
                    {r.current.topErrorSource ? `${t(`rt.name.${r.current.topErrorSource.runtime}`)} (${n(r.current.topErrorSource.count)})` : NO_VALUE}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </section>
      </div>

      {data && (
        <section className="ov-card ov-section lg-pipeline">
          <header className="ov-section-head">
            <h3>{t('logs.pipeline.title')}</h3>
          </header>
          <dl className="rt-kv">
            <div>
              <dt>{t('logs.pipeline.backend')}</dt>
              <dd>{t('logs.backend.redis')}</dd>
            </div>
            <div>
              <dt>{t('logs.pipeline.history')}</dt>
              <dd>{t('logs.pipeline.limited', { count: n(data.backend.bufferSize) })}</dd>
            </div>
            <div>
              <dt>{t('logs.pipeline.lastIngest')}</dt>
              <dd>{data.lastIngestAt ? formatRelative(data.lastIngestAt, now) : NO_VALUE}</dd>
            </div>
            <div>
              <dt>{t('logs.pipeline.redaction')}</dt>
              <dd>
                <span className="pf-chip ov-tone-ok">
                  <ShieldCheck size={12} /> {t('logs.pipeline.redactionOn')}
                </span>
              </dd>
            </div>
            {data.levelsActive.map((a) => (
              <div key={a.runtime}>
                <dt>{t('logs.pipeline.levelOverride', { runtime: t(`rt.name.${a.runtime}`) })}</dt>
                <dd>
                  <span className="pf-chip ov-tone-warn">{a.level}</span>{' '}
                  {a.until ? t('logs.config.until', { when: formatRelative(a.until, now) }) : t('logs.config.untilChanged')}
                  {a.modules.length > 0 && <small className="pf-row-note">{a.modules.join(', ')}</small>}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </>
  );
};

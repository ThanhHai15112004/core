import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, GitBranch, Search, XCircle } from 'lucide-react';
import type { LogRow, Trace, TraceEvent } from '../../types/logs.types';
import { logsApi } from '../../services/logs.api';
import { ApiError } from '../../../../core/services/api';
import { contextPath, logTime } from '../../utils/logs-format';
import { formatMs } from '../../utils/worker-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

interface Props {
  id: string | null;
  openTrace: (id: string) => void;
  openLog: (id: string) => void;
  navigate: (path: string) => void;
  now: number;
}

const linkPath = (l: NonNullable<TraceEvent['link']>) => contextPath(l.kind, l.id, l.queue);

/**
 * Trace / Correlation: dán Request / Job / Execution / Correlation ID → mọi sự kiện cùng chuỗi xử lý (request HTTP, lần
 * chạy Scheduler, job, log mọi runtime) theo thời gian; luồng thành phần và điểm lỗi đầu tiên (không gọi là root cause).
 */
export const LogsTraceView: React.FC<Props> = ({ id, openTrace, openLog, navigate, now }) => {
  const { t, formatTime, formatRelative } = useLocale();
  const [input, setInput] = useState(id ?? '');
  const [data, setData] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recent, setRecent] = useState<LogRow[] | null>(null);

  useEffect(() => {
    setInput(id ?? '');
    if (!id) {
      setData(null);
      logsApi
        .search({ level: 'error,fatal', window: '24h' }, null, 200)
        .then((r) => setRecent(r.items))
        .catch(() => setRecent([]));
      return;
    }
    let alive = true;
    setData(null);
    setError(null);
    logsApi
      .trace(id)
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [id]);

  /** Chuỗi lỗi gần đây (mỗi correlation một dòng) để bắt đầu điều tra. */
  const failing = useMemo(() => {
    const seen = new Map<string, LogRow>();
    for (const r of recent ?? []) {
      const key = r.correlationId ?? r.requestId ?? r.jobId;
      if (key && !seen.has(key)) seen.set(key, r);
    }
    return [...seen.entries()].slice(0, 12);
  }, [recent]);

  return (
    <>
      <section className="ov-card ov-section">
        <form
          className="lg-search-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) openTrace(input.trim());
          }}
        >
          <label className="lg-search-box">
            <GitBranch size={15} />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('logs.trace.placeholder')}
              aria-label={t('logs.trace.placeholder')}
              spellCheck={false}
            />
          </label>
          <button type="submit" className="scp-btn scp-btn-sm scp-btn-primary">
            <Search size={13} /> {t('logs.trace.open')}
          </button>
        </form>
        <p className="lg-hint">{t('logs.trace.hint')}</p>
      </section>

      {!id && (
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('logs.trace.recentFailing')}</h3>
            <span className="ov-section-hint">{t('logs.window.24h')}</span>
          </header>
          {recent === null ? (
            <p className="ov-empty-line">{t('common.loading')}</p>
          ) : failing.length === 0 ? (
            <p className="ov-empty-line">{t('logs.trace.noneFailing')}</p>
          ) : (
            <ul className="lg-trace-list">
              {failing.map(([key, r]) => (
                <li key={key}>
                  <button type="button" className="ov-link" onClick={() => openTrace(key)}>
                    <code>{key}</code>
                  </button>
                  <span className="lg-message">{r.message}</span>
                  <small className="ov-muted">
                    {r.runtime} · {formatRelative(r.at, now)}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {error && <p className="scp-alert scp-alert-danger">{error}</p>}
      {id && !data && !error && <p className="ov-empty-line">{t('common.loading')}</p>}

      {data && (
        <>
          <section className="ov-card ov-section">
            <header className="ov-section-head">
              <div>
                <h3>
                  {t('logs.trace.title')} <code>{data.correlationId ?? data.id}</code>
                </h3>
                <p className="lg-note">{t('logs.trace.resolved', { kinds: data.resolvedFrom.map((k) => t(`logs.ctx.${k}`)).join(', ') || NO_VALUE })}</p>
              </div>
              <span className={`pf-chip ov-tone-${data.status === 'failed' ? 'crit' : data.status === 'running' ? 'warn' : 'ok'}`}>
                {t(`logs.trace.status.${data.status}`)}
              </span>
            </header>
            <div className="lg-trace-stats">
              <div>
                <span>{t('logs.trace.duration')}</span>
                <strong>{data.durationMs !== null ? formatMs(data.durationMs) : NO_VALUE}</strong>
              </div>
              <div>
                <span>{t('logs.trace.services')}</span>
                <strong>{data.services.length}</strong>
              </div>
              <div>
                <span>{t('logs.trace.logs')}</span>
                <strong>{data.counts.logs}</strong>
              </div>
              <div>
                <span>{t('logs.trace.errors')}</span>
                <strong className={data.counts.errors ? 'lg-err' : ''}>{data.counts.errors}</strong>
              </div>
              <div>
                <span>{t('logs.trace.jobs')}</span>
                <strong>{data.counts.jobs}</strong>
              </div>
              <div>
                <span>{t('logs.trace.requests')}</span>
                <strong>{data.counts.requests}</strong>
              </div>
            </div>
            <dl className="rt-kv">
              {data.root && (
                <div>
                  <dt>{t('logs.trace.root')}</dt>
                  <dd>
                    {data.root.label} <small className="ov-muted">{logTime(data.root.at)}</small>
                  </dd>
                </div>
              )}
              {data.failurePoint && (
                <div>
                  <dt>{t('logs.trace.failurePoint')}</dt>
                  <dd>
                    <XCircle size={13} className="lg-err" /> <strong>{data.failurePoint.errorType ?? data.failurePoint.label}</strong> ·{' '}
                    {data.failurePoint.component}
                    {data.failurePoint.logId && (
                      <button type="button" className="ov-link" onClick={() => openLog(data.failurePoint!.logId!)}>
                        {t('logs.trace.openLog')}
                      </button>
                    )}
                    <small className="pf-row-note">{t('logs.trace.failureNote')}</small>
                  </dd>
                </div>
              )}
            </dl>
            {data.truncated && <p className="scp-alert scp-alert-warning">{t('logs.trace.truncated')}</p>}
          </section>

          <section className="ov-card ov-section">
            <header className="ov-section-head">
              <h3>{t('logs.trace.flow')}</h3>
            </header>
            <div className="lg-flow">
              {data.flow.map((n, i) => (
                <React.Fragment key={`${n.component}-${n.label}-${i}`}>
                  {i > 0 && <ArrowRight size={14} className="lg-flow-arrow" />}
                  <button
                    type="button"
                    className={`lg-flow-node ${n.status === 'error' ? 'is-error' : ''}`}
                    onClick={() => n.link && navigate(linkPath(n.link))}
                    disabled={!n.link}
                    title={`${n.events} · ${formatTime(n.firstAt, true)}`}
                  >
                    <small>{t(`logs.component.${n.component}`) === `logs.component.${n.component}` ? n.component : t(`logs.component.${n.component}`)}</small>
                    <span>
                      {n.status === 'error' && '✕ '}
                      {n.label}
                    </span>
                  </button>
                </React.Fragment>
              ))}
            </div>
          </section>

          <section className="ov-card ov-section">
            <header className="ov-section-head">
              <h3>{t('logs.trace.timeline')}</h3>
              <span className="ov-section-hint">{t('logs.trace.events', { count: data.events.length })}</span>
            </header>
            <ol className="lg-timeline">
              {data.events.map((e, i) => (
                <li key={i} className={`lg-tl-${e.level}`}>
                  <time>{logTime(e.at)}</time>
                  <span className="lg-tl-comp">{e.component}</span>
                  <div className="lg-tl-body">
                    <span>
                      {e.module && <span className="lg-module">[{e.module}]</span>}
                      {e.label}
                    </span>
                    {e.detail && <small className="ov-muted">{e.detail}</small>}
                  </div>
                  <span className="lg-tl-actions">
                    {e.logId && (
                      <button type="button" className="ov-link" onClick={() => openLog(e.logId!)}>
                        {t('logs.trace.openLog')}
                      </button>
                    )}
                    {e.link && (
                      <button type="button" className="ov-link" onClick={() => navigate(linkPath(e.link!))}>
                        {t(`logs.trace.open_${e.link.kind}`)}
                      </button>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </>
  );
};

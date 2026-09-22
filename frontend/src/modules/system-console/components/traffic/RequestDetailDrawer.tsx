import React, { useEffect, useState } from 'react';
import { Check, Copy, FileText, Filter, Info, X } from 'lucide-react';
import type { CapturedBody, RequestDetailResponse, TimelinePhase } from '../../types/traffic.types';
import type { RuntimeLog } from '../../types/runtime.types';
import { trafficApi } from '../../services/traffic.api';
import { ApiError } from '../../../../core/services/api';
import { formatMs } from '../../utils/traffic-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { ConsolePortal } from '../common/ConsolePortal';
import { HttpStatusBadge, MethodBadge } from './TrafficBadges';
import { useLocale } from '../../../../core/i18n/index';

const DETAIL_TABS = ['summary', 'timeline', 'headers', 'body', 'response', 'logs'] as const;
type DetailTab = (typeof DETAIL_TABS)[number];
const COPY_FEEDBACK_MS = 1500;

interface RequestDetailDrawerProps {
  requestId: string;
  onClose: () => void;
  onOpenLogs: (correlationId: string) => void;
  onOpenEndpoint: (routeId: string) => void;
}

const CopyButton: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="scp-btn scp-btn-sm scp-btn-secondary"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
      }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? t('console.drawer.copied') : label}
    </button>
  );
};

const HeaderTable: React.FC<{ headers: Record<string, string> }> = ({ headers }) => (
  <table className="scp-table tr-kv-table">
    <tbody>
      {Object.entries(headers).map(([k, v]) => (
        <tr key={k}>
          <th>{k}</th>
          <td>
            <code>{v}</code>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

const BodyView: React.FC<{ body: CapturedBody }> = ({ body }) => {
  const { t } = useLocale();
  if (body.kind === 'none') return <p className="ov-empty-line">{t(`tr.detail.bodyOmitted.${body.omitted ?? 'empty'}`)}</p>;
  return (
    <>
      {body.truncated && <p className="tr-note-inline">{t('tr.detail.truncated', { size: body.sizeBytes ?? NO_VALUE })}</p>}
      <pre className="tr-code-block">{body.kind === 'json' ? JSON.stringify(body.value, null, 2) : String(body.value ?? '')}</pre>
    </>
  );
};

/** Chi tiết một request: summary, timeline vòng đời thật, header/body đã mask, response, log cùng correlation id. */
export const RequestDetailDrawer: React.FC<RequestDetailDrawerProps> = ({ requestId, onClose, onOpenLogs, onOpenEndpoint }) => {
  const { t, formatTime } = useLocale();
  const [tab, setTab] = useState<DetailTab>('summary');
  const [data, setData] = useState<RequestDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<RuntimeLog[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    setLogs(null);
    trafficApi
      .request(requestId)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        const cid = res.summary.correlationId;
        if (cid) {
          trafficApi
            .relatedLogs(cid)
            .then((l) => !cancelled && setLogs(l))
            .catch(() => !cancelled && setLogs([]));
        } else setLogs([]);
      })
      .catch((err: unknown) => !cancelled && setError(err instanceof ApiError || err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [requestId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const s = data?.summary;
  const d = data?.detail ?? null;
  const time = (ms: number) => `${new Date(ms).toLocaleDateString()} ${formatTime(ms)}.${String(ms % 1000).padStart(3, '0')}`;

  const renderTab = () => {
    if (!s) return null;
    if (tab !== 'summary' && tab !== 'logs' && !d) {
      return (
        <p className="tr-note">
          <Info size={15} /> <span>{t('tr.detail.notCaptured')}</span>
        </p>
      );
    }
    switch (tab) {
      case 'summary': {
        const rows: [string, React.ReactNode][] = [
          [t('tr.detail.requestId'), <code key="id">{s.id}</code>],
          [t('tr.detail.correlationId'), s.correlationId ? <code key="cid">{s.correlationId}</code> : NO_VALUE],
          [t('tr.detail.method'), s.method],
          [t('tr.detail.url'), <code key="url">{s.path}</code>],
          [t('tr.detail.route'), <code key="route">{s.route}</code>],
          [t('tr.detail.status'), <HttpStatusBadge key="st" status={s.status} />],
          [t('tr.detail.duration'), formatMs(s.durationMs)],
          [t('tr.detail.runtime'), `api · ${s.instance}`],
          [t('tr.detail.started'), time(s.at)],
          [t('tr.detail.errorCode'), s.errorCode ?? NO_VALUE],
        ];
        if (d) {
          rows.push(
            [t('tr.detail.captureReason'), t(`tr.detail.reason.${d.captureReason}`)],
            [t('tr.detail.ip'), d.ip ?? NO_VALUE],
            [t('tr.detail.userAgent'), d.userAgent ?? NO_VALUE],
          );
          if (d.error) rows.push([t('tr.detail.error'), `${d.error.name}: ${d.error.message}`]);
          if (Object.keys(d.query).length > 0) rows.push([t('tr.detail.query'), <code key="q">{JSON.stringify(d.query)}</code>]);
        }
        return (
          <>
            {!d && (
              <p className="tr-note">
                <Info size={15} /> <span>{t('tr.detail.notCaptured')}</span>
              </p>
            )}
            <dl className="rt-kv">
              {rows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </>
        );
      }
      case 'timeline': {
        const marks = d!.timeline;
        const total = Math.max(s.durationMs, 0.1);
        const segments = marks.slice(1).map((m, i) => {
          const prev = marks[i]!;
          return { from: prev.phase, to: m.phase, start: prev.offsetMs, ms: Math.max(0, m.offsetMs - prev.offsetMs) };
        });
        return (
          <>
            <ol className="tr-timeline">
              {marks.map((m) => (
                <li key={m.phase}>
                  <span className="tr-mono">{formatMs(m.offsetMs)}</span>
                  <span>{t(`tr.phase.${m.phase satisfies TimelinePhase}`)}</span>
                </li>
              ))}
            </ol>
            <h4 className="tr-subtitle">{t('tr.detail.breakdown')}</h4>
            <ul className="tr-waterfall">
              {segments.map((seg) => (
                <li key={seg.to}>
                  <span className="tr-waterfall-label">{t(`tr.segment.${seg.to}`)}</span>
                  <span className="tr-waterfall-track">
                    <span style={{ left: `${(seg.start / total) * 100}%`, width: `${Math.max(1, (seg.ms / total) * 100)}%` }} />
                  </span>
                  <span className="tr-mono">{formatMs(seg.ms)}</span>
                </li>
              ))}
            </ul>
            <p className="tr-note-inline">{t('tr.detail.tracingNote')}</p>
          </>
        );
      }
      case 'headers':
        return (
          <>
            <h4 className="tr-subtitle">{t('tr.detail.requestHeaders')}</h4>
            <HeaderTable headers={d!.headers} />
            <h4 className="tr-subtitle">{t('tr.detail.responseHeaders')}</h4>
            <HeaderTable headers={d!.responseHeaders} />
            <p className="tr-note-inline">{t('tr.detail.maskedNote')}</p>
          </>
        );
      case 'body':
        return <BodyView body={d!.requestBody} />;
      case 'response':
        return (
          <>
            <dl className="rt-kv">
              <div>
                <dt>{t('tr.detail.status')}</dt>
                <dd>
                  <HttpStatusBadge status={s.status} />
                </dd>
              </div>
              <div>
                <dt>{t('tr.detail.duration')}</dt>
                <dd>{formatMs(s.durationMs)}</dd>
              </div>
            </dl>
            <BodyView body={d!.responseBody} />
          </>
        );
      case 'logs':
        return logs === null ? (
          <p className="ov-empty-line">{t('common.loading')}</p>
        ) : logs.length === 0 ? (
          <p className="ov-empty-line">{s.correlationId ? t('tr.detail.noLogs') : t('tr.detail.noCorrelation')}</p>
        ) : (
          <div className="log-viewer-stream rt-log-stream">
            {logs.map((l, i) => (
              <div key={`${l.t}-${i}`} className="log-line">
                <span className="log-time">{formatTime(l.t)}</span>
                <span className={`log-chip level-${l.level === 'fatal' ? 'error' : l.level}`}>{l.level}</span>
                {l.context && <span className="log-source">[{l.context}]</span>}
                <span className="log-msg">{l.message}</span>
              </div>
            ))}
          </div>
        );
    }
  };

  return (
    <ConsolePortal>
      <>
        <div className="drawer-backdrop" onClick={onClose} />
        <aside className="detail-drawer tr-drawer" role="dialog" aria-modal="true" aria-label={t('tr.detail.title')}>
          <div className="drawer-header">
            <div className="tr-drawer-title">
              {s ? (
                <>
                  <span className="tr-endpoint">
                    <MethodBadge method={s.method} />
                    <code>{s.path}</code>
                  </span>
                  <span className="tr-drawer-meta">
                    <HttpStatusBadge status={s.status} /> {formatMs(s.durationMs)} · {time(s.at)}
                  </span>
                </>
              ) : (
                <strong>{t('tr.detail.title')}</strong>
              )}
            </div>
            <button type="button" className="rt-icon-btn" onClick={onClose} aria-label={t('common.close')}>
              <X size={18} />
            </button>
          </div>

          <div className="drawer-body">
            {error && <p className="scp-alert scp-alert-danger">{error}</p>}
            {!data && !error && <p className="ov-empty-line">{t('common.loading')}</p>}
            {s && (
              <>
                <div className="tr-drawer-actions">
                  <CopyButton value={s.id} label={t('tr.detail.copyId')} />
                  {s.correlationId && (
                    <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => onOpenLogs(s.correlationId!)}>
                      <FileText size={13} /> {t('tr.detail.openLogs')}
                    </button>
                  )}
                  <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => onOpenEndpoint(s.routeId)}>
                    <Filter size={13} /> {t('tr.detail.openEndpoint')}
                  </button>
                </div>
                <nav className="rt-tabs" role="tablist">
                  {DETAIL_TABS.map((id) => (
                    <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>
                      {t(`tr.detail.tab.${id}`)}
                      {id === 'logs' && logs && logs.length > 0 && <span className="ov-count">{logs.length}</span>}
                    </button>
                  ))}
                </nav>
                <div className="tr-drawer-content">{renderTab()}</div>
              </>
            )}
          </div>
        </aside>
      </>
    </ConsolePortal>
  );
};

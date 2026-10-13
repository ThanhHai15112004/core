import React, { useEffect, useState } from 'react';
import { Briefcase, CalendarClock, Database, GitBranch, Globe, Layers, Mail, ShieldCheck, X } from 'lucide-react';
import type { LogDetail, LogRow } from '../../types/logs.types';
import { logsApi } from '../../services/logs.api';
import { ApiError } from '../../../../core/services/api';
import { ConsolePortal } from '../common/ConsolePortal';
import { Collapsible, CopyButton, LevelChip } from './LogBits';
import { LogTable } from './LogTable';
import { DEPENDENCY_SECTION } from '../../constants/logs';
import { browserTimeZone, contextPath, logDateTime } from '../../utils/logs-format';
import { formatMs } from '../../utils/worker-format';
import { useLocale } from '../../../../core/i18n/index';

interface Props {
  logId: string;
  onClose: () => void;
  onOpenLog: (id: string) => void;
  onTrace: (id: string) => void;
  onError: (fingerprint: string) => void;
  navigate: (path: string) => void;
}

/**
 * Chi tiết một log: ngữ cảnh (runtime, module, request / job / message / execution), metadata có cấu trúc (đã redact
 * ở backend), stack trace thu gọn, chuỗi log ngay trước / sau trên cùng instance và các link điều tra sang màn khác.
 */
export const LogDetailDrawer: React.FC<Props> = ({ logId, onClose, onOpenLog, onTrace, onError, navigate }) => {
  const { t, formatRelative } = useLocale();
  const [data, setData] = useState<LogDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    logsApi
      .entry(logId)
      .then((d) => alive && setData(d))
      .catch((e: unknown) => alive && setError(e instanceof ApiError ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [logId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const d = data;
  const l = d?.links;
  const rows: { label: string; value: React.ReactNode }[] = d
    ? [
        { label: t('logs.detail.source'), value: d.runtime ?? '—' },
        { label: t('logs.detail.instance'), value: d.instance ? <code>{d.instance}</code> : '—' },
        { label: t('logs.detail.module'), value: d.module ?? '—' },
        ...(d.correlationId ? [{ label: t('logs.ctx.correlation'), value: <code>{d.correlationId}</code> }] : []),
        ...(d.requestId
          ? [
              {
                label: t('logs.ctx.request'),
                value: (
                  <>
                    <code>{d.requestId}</code>
                    {l?.request?.route && <small className="pf-row-note">{`${l.request.method ?? ''} ${l.request.route} ${l.request.status ?? ''}`}</small>}
                  </>
                ),
              },
            ]
          : []),
        ...(d.jobId
          ? [
              {
                label: t('logs.ctx.job'),
                value: (
                  <>
                    <code>{d.jobId}</code>
                    {(l?.job?.type ?? d.jobType) && <small className="pf-row-note">{l?.job?.type ?? d.jobType}</small>}
                  </>
                ),
              },
            ]
          : []),
        ...(d.messageId && d.messageId !== d.jobId ? [{ label: t('logs.ctx.message'), value: <code>{d.messageId}</code> }] : []),
        ...(d.executionId
          ? [
              {
                label: t('logs.ctx.execution'),
                value: (
                  <>
                    <code>{d.executionId}</code>
                    {l?.execution?.taskId && <small className="pf-row-note">{l.execution.taskId}</small>}
                  </>
                ),
              },
            ]
          : []),
        ...(d.userId ? [{ label: t('logs.ctx.user'), value: <code>{d.userId}</code> }] : []),
        ...(d.route ? [{ label: t('logs.detail.endpoint'), value: <code>{d.route}</code> }] : []),
        ...(d.status !== null ? [{ label: t('logs.detail.status'), value: d.status }] : []),
        ...(d.errorType ? [{ label: t('logs.detail.errorType'), value: <code>{d.errorType}</code> }] : []),
        ...(d.errorCode ? [{ label: t('logs.detail.errorCode'), value: <code>{d.errorCode}</code> }] : []),
        ...(d.durationMs !== null ? [{ label: t('logs.detail.duration'), value: formatMs(d.durationMs) }] : []),
      ]
    : [];

  /** Chuỗi log theo thời gian: trước (cũ hơn) → log này → sau. */
  const sequence: LogRow[] = d ? [...d.after, d as LogRow, ...d.before] : [];

  return (
    <ConsolePortal>
      <>
        <div className="drawer-backdrop" onClick={onClose} />
        <aside className="detail-drawer tr-drawer lg-drawer" role="dialog" aria-modal="true" aria-label={t('logs.detail.title')}>
          <div className="drawer-header">
            <div className="tr-drawer-title">
              {d ? (
                <>
                  <span className="lg-drawer-level">
                    <LevelChip level={d.level} />
                    <time dateTime={d.at}>
                      {logDateTime(d.at)} <small className="ov-muted">({browserTimeZone()})</small>
                    </time>
                  </span>
                  <strong className="lg-drawer-message">{d.message}</strong>
                </>
              ) : (
                <strong>{t('logs.detail.title')}</strong>
              )}
            </div>
            <button type="button" className="rt-icon-btn" onClick={onClose} aria-label={t('common.close')}>
              <X size={18} />
            </button>
          </div>

          <div className="drawer-body">
            {error && <p className="scp-alert scp-alert-danger">{error}</p>}
            {!d && !error && <p className="ov-empty-line">{t('common.loading')}</p>}
            {d && l && (
              <>
                <div className="tr-drawer-actions">
                  <CopyButton value={d.id} label={t('logs.detail.copyId')} />
                  {(l.correlationId ?? d.requestId ?? d.jobId) && (
                    <button type="button" className="scp-btn scp-btn-sm scp-btn-primary" onClick={() => onTrace(l.correlationId ?? d.requestId ?? d.jobId!)}>
                      <GitBranch size={13} /> {t('logs.detail.viewTrace')}
                    </button>
                  )}
                  {l.request && (
                    <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate(contextPath('request', l.request!.id))}>
                      <Globe size={13} /> {t('logs.detail.openRequest')}
                    </button>
                  )}
                  {l.job && (
                    <button
                      type="button"
                      className="scp-btn scp-btn-sm scp-btn-secondary"
                      onClick={() => navigate(contextPath('job', l.job!.id, l.job!.queue))}
                    >
                      <Briefcase size={13} /> {t('logs.detail.openJob')}
                    </button>
                  )}
                  {l.execution && (
                    <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate(contextPath('execution', l.execution!.id))}>
                      <CalendarClock size={13} /> {t('logs.detail.openExecution')}
                    </button>
                  )}
                  {l.message && (
                    <button
                      type="button"
                      className="scp-btn scp-btn-sm scp-btn-secondary"
                      onClick={() => navigate(`messaging/messages/${encodeURIComponent(l.message!.id)}`)}
                    >
                      <Mail size={13} /> {t('logs.detail.openMessage')}
                    </button>
                  )}
                  {l.dependency && (
                    <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate(DEPENDENCY_SECTION[l.dependency!]!)}>
                      <Database size={13} /> {t('logs.detail.openDependency', { name: t(`logs.dependency.${l.dependency}`) })}
                    </button>
                  )}
                  {d.group && (
                    <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => onError(d.group!.fingerprint)}>
                      <Layers size={13} /> {t('logs.detail.openGroup', { count: d.group.count })}
                    </button>
                  )}
                </div>

                {d.group && (
                  <p className="lg-note">
                    {t('logs.detail.groupNote', {
                      count: d.group.count,
                      first: d.group.firstSeen ? formatRelative(d.group.firstSeen) : '—',
                    })}
                  </p>
                )}

                <section className="lg-drawer-section">
                  <h4>{t('logs.detail.context')}</h4>
                  <dl className="rt-kv">
                    {rows.map((r) => (
                      <div key={r.label}>
                        <dt>{r.label}</dt>
                        <dd>{r.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                {d.detailsHidden && <p className="scp-alert scp-alert-info">{t('logs.detail.hidden')}</p>}

                {d.metadata && (
                  <section className="lg-drawer-section">
                    <div className="lg-section-head">
                      <h4>{t('logs.detail.metadata')}</h4>
                      <CopyButton value={JSON.stringify(d.metadata, null, 2)} label={t('logs.detail.copyJson')} />
                    </div>
                    <pre className="tr-code-block lg-json">{JSON.stringify(d.metadata, null, 2)}</pre>
                    <p className="lg-note">
                      <ShieldCheck size={12} /> {t('logs.detail.redactedNote')}
                    </p>
                  </section>
                )}

                {d.stack && (
                  <section className="lg-drawer-section">
                    <Collapsible title={t('logs.detail.stack')} copy={d.stack} copyLabel={t('logs.detail.copyStack')}>
                      <pre className="job-pre lg-stack">{d.stack}</pre>
                    </Collapsible>
                  </section>
                )}

                {sequence.length > 1 && (
                  <section className="lg-drawer-section">
                    <h4>{t('logs.detail.sequence')}</h4>
                    <p className="lg-note">{t('logs.detail.sequenceNote', { instance: d.instance ?? '—' })}</p>
                    <LogTable rows={sequence} onOpen={(id) => id !== d.id && onOpenLog(id)} selectedId={d.id} compact />
                  </section>
                )}
              </>
            )}
          </div>
        </aside>
      </>
    </ConsolePortal>
  );
};

import React, { useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, Ban, Copy, ExternalLink, FileText, Layers, RotateCcw, Trash2 } from 'lucide-react';
import type { ActionState, JobDetail, JobDetailTab, JobRow } from '../../types/jobs.types';
import type { JobAction } from '../../hooks/useJobActions';
import { jobsApi } from '../../services/jobs.api';
import { usePolling } from '../../hooks/usePolling';
import { JOB_DETAIL_TABS, DEPENDENCY_PATH } from '../../constants/jobs';
import { JobProgressBar, JobStatusChip } from '../../components/jobs/JobStatus';
import { JobLifecycle } from '../../components/jobs/JobLifecycle';
import { JobAttempts, StackTrace } from '../../components/jobs/JobAttempts';
import { JobTable } from '../../components/jobs/JobTable';
import { formatBytes } from '../../utils/database-format';
import { formatMs, instanceLabel, shortJobId } from '../../utils/worker-format';
import { formatIn, secondsUntil } from '../../utils/scheduler-format';
import { attemptsLabel } from '../../utils/jobs-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

const row = (label: string, value: React.ReactNode) => (
  <div>
    <dt>{label}</dt>
    <dd>{value}</dd>
  </div>
);

/**
 * Job Detail (full page): trạng thái, thời gian chờ vs xử lý (chậm vì backlog hay vì chính job), vòng đời, các lần thử,
 * lỗi (loại, dependency → trang hạ tầng, stack thu gọn), nguồn (HTTP / Scheduler / job cha) và correlation, payload
 * (metadata trước, nội dung đã redact khi bấm), kết quả, log liên quan, cấu hình; Retry / Cancel / Remove khi phù hợp.
 */
export const JobDetailView: React.FC<{
  id: string;
  queue: string | null;
  sub: JobDetailTab;
  now: number;
  paused: boolean;
  onSub: (s: JobDetailTab) => void;
  onBack: () => void;
  onAction: (action: JobAction, job: JobRow, detail: JobDetail | null) => void;
  openJob: (id: string, queue?: string | null) => void;
  navigate: (path: string) => void;
}> = ({ id, queue, sub, now, paused, onSub, onBack, onAction, openJob, navigate }) => {
  const { t, formatTime, formatRelative } = useLocale();
  const { data, error } = usePolling(() => jobsApi.job(id, queue), `job:${id}:${queue ?? ''}`, 5000, paused);
  const [payload, setPayload] = useState<{
    value: unknown;
    error: string | null;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  if (error && !data) {
    return (
      <>
        <button type="button" className="ov-link" onClick={onBack}>
          <ArrowLeft size={13} /> {t('nav.jobs')}
        </button>
        <section className="tr-empty-state" role="alert">
          <Ban size={28} />
          <h2>{t('jobs.detail.notFound')}</h2>
          <p>{error.message}</p>
        </section>
      </>
    );
  }
  if (!data) return <p className="ov-empty-line">{t('common.loading')}</p>;

  const j = data.job;
  const at = (v: string | null) => (v ? `${new Date(v).toLocaleDateString()} ${formatTime(Date.parse(v), true)}` : NO_VALUE);
  const logsPath = `logs/explorer?${data.logsMatchedBy === 'correlation' && j.correlationId ? `correlationId=${encodeURIComponent(j.correlationId)}` : `jobId=${encodeURIComponent(j.id)}`}`;
  const actionBtn = (action: JobAction, state: ActionState, icon: React.ReactNode, cls: string, label: string) => (
    <button
      type="button"
      className={`scp-btn scp-btn-sm ${cls}`}
      disabled={!state.allowed}
      title={state.reason ? t(`jobs.detail.reason.${state.reason}`) : undefined}
      onClick={() => onAction(action, j, data)}
    >
      {icon} {label}
    </button>
  );
  const copyId = () => {
    void navigator.clipboard?.writeText(j.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  const viewPayload = async () => {
    try {
      const r = await jobsApi.payload(j.id, j.queue);
      setPayload({ value: r.payload, error: null });
    } catch (err) {
      setPayload({
        value: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
  const src = data.source;
  const c = data.correlation;
  const failure = data.failure;
  const dep = failure?.dependency ?? null;

  const sourcePanel = (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('jobs.detail.source')}</h3>
      </header>
      <dl className="db-stat-grid">
        {row(t('jobs.col.source'), <strong>{t(`jobs.source.${src.kind}`)}</strong>)}
        {src.kind === 'http' && row(t('jobs.detail.request'), src.name ?? NO_VALUE)}
        {src.kind === 'scheduler' && row(t('jobs.detail.task'), src.name ?? NO_VALUE)}
        {src.kind === 'job' && row(t('jobs.detail.parentJob'), src.name ?? NO_VALUE)}
        {(src.kind === 'system' || src.kind === 'manual') && row(t('jobs.detail.producer'), src.name ?? NO_VALUE)}
      </dl>
      <div className="job-actions-row">
        {src.kind === 'http' && c.requestId && (
          <button
            type="button"
            className="scp-btn scp-btn-sm scp-btn-secondary"
            onClick={() => navigate(`http-traffic/requests/${encodeURIComponent(c.requestId!)}`)}
          >
            <ExternalLink size={13} /> {t('jobs.detail.openRequest')}
          </button>
        )}
        {src.kind === 'scheduler' && c.schedulerExecutionId && (
          <button
            type="button"
            className="scp-btn scp-btn-sm scp-btn-secondary"
            onClick={() => navigate(`scheduler/history?exec=${encodeURIComponent(c.schedulerExecutionId!)}`)}
          >
            <ExternalLink size={13} /> {t('jobs.detail.openExecution')}
          </button>
        )}
        {src.kind === 'scheduler' && src.name && (
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate(`scheduler/tasks/${encodeURIComponent(src.name!)}`)}>
            {t('jobs.detail.openTask')}
          </button>
        )}
        {src.kind === 'job' && c.parentJobId && (
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => openJob(c.parentJobId!, c.parentQueue)}>
            <Layers size={13} /> {t('jobs.detail.openParent')}
          </button>
        )}
      </div>
      <h4>{t('jobs.detail.correlation')}</h4>
      <dl className="db-stat-grid db-stat-compact">
        {row(
          t('jobs.detail.correlationId'),
          c.correlationId ? (
            <button type="button" className="ov-link" onClick={() => navigate(`logs/explorer?correlationId=${encodeURIComponent(c.correlationId!)}`)}>
              <code>{c.correlationId}</code>
            </button>
          ) : (
            NO_VALUE
          ),
        )}
        {row(t('jobs.detail.requestId'), c.requestId ? <code>{c.requestId}</code> : NO_VALUE)}
        {row(
          t('jobs.detail.messageId'),
          <button
            type="button"
            className="ov-link"
            onClick={() => navigate(`messaging/messages/${encodeURIComponent(c.messageId)}?q=${encodeURIComponent(j.queue)}`)}
          >
            <code>{shortJobId(c.messageId)}</code>
          </button>,
        )}
        {row(t('jobs.detail.schedulerExecution'), c.schedulerExecutionId ? <code>{c.schedulerExecutionId}</code> : NO_VALUE)}
      </dl>
      <p className="job-flow">
        {[
          src.kind === 'http'
            ? t('jobs.flow.http')
            : src.kind === 'scheduler'
              ? t('jobs.flow.scheduler')
              : src.kind === 'job'
                ? t('jobs.flow.parent')
                : t(`jobs.source.${src.kind}`),
          t('jobs.flow.message'),
          t('jobs.flow.job'),
          j.worker ?? t('jobs.flow.worker'),
          ...(dep ? [t(`jobs.dependency.${dep}`)] : []),
        ].join('  →  ')}
      </p>
    </section>
  );

  const failurePanel = failure && (
    <section className="ov-card ov-section sch-failure">
      <h4>
        <AlertTriangle size={15} /> {t('jobs.failure.title')}
      </h4>
      <dl className="db-stat-grid">
        {row(t('jobs.failure.type'), <code>{failure.type}</code>)}
        {row(t('jobs.failure.occurred'), at(failure.occurredAt))}
        {row(t('jobs.failure.attempt'), `${failure.attempt} / ${failure.maxAttempts}`)}
        {row(t('jobs.failure.dependency'), dep ? t(`jobs.dependency.${dep}`) : t('jobs.failure.noDependency'))}
        {row(t('jobs.failure.retryable'), t(`jobs.retryable.${failure.retryable === false ? 'no' : failure.retryable ? 'yes' : 'unknown'}`))}
      </dl>
      <p className="sch-error-message">{failure.message}</p>
      <div className="job-actions-row">
        {dep && DEPENDENCY_PATH[dep] && (
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate(DEPENDENCY_PATH[dep]!)}>
            {t('jobs.dependency.open', { name: t(`jobs.dependency.${dep}`) })} <ArrowRight size={12} />
          </button>
        )}
        <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate(logsPath)}>
          <FileText size={13} /> {t('jobs.detail.openLogs')}
        </button>
      </div>
      {failure.stack && <StackTrace stack={failure.stack} />}
    </section>
  );

  const renderSub = () => {
    switch (sub) {
      case 'lifecycle':
        return (
          <section className="ov-card ov-section">
            <header className="ov-section-head">
              <h3>{t('jobs.detail.tab.lifecycle')}</h3>
            </header>
            <JobLifecycle steps={data.lifecycle} available={data.lifecycleAvailable} />
          </section>
        );
      case 'attempts':
        return (
          <section className="ov-card ov-section">
            <header className="ov-section-head">
              <h3>{t('jobs.detail.tab.attempts')}</h3>
              {data.config.backoff && (
                <span className="ov-section-hint">
                  {t('jobs.detail.backoffHint', {
                    type: data.config.backoff.type,
                    delay: formatMs(data.config.backoff.delayMs),
                  })}
                </span>
              )}
            </header>
            <JobAttempts attempts={data.attempts} maxAttempts={j.maxAttempts} exhausted={j.status === 'failed' && j.attempts >= j.maxAttempts} />
          </section>
        );
      case 'payload':
        return (
          <>
            <section className="ov-card ov-section">
              <header className="ov-section-head">
                <h3>{t('jobs.payload.title')}</h3>
              </header>
              <dl className="db-stat-grid">
                {row(t('jobs.payload.size'), formatBytes(data.payload.sizeBytes))}
                {row(t('jobs.payload.contentType'), data.payload.contentType)}
                {row(t('jobs.payload.schema'), data.payload.schema ?? t('jobs.payload.noSchema'))}
                {row(t('jobs.payload.fields'), data.payload.fields ?? NO_VALUE)}
              </dl>
              {Object.keys(data.payload.index).length > 0 && (
                <>
                  <h4>{t('jobs.payload.index')}</h4>
                  <dl className="db-stat-grid db-stat-compact">
                    {Object.entries(data.payload.index).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>
                          <code>{v}</code>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
              {data.payload.malformed && <p className="msg-status-line ov-tone-warn">{t('jobs.payload.malformed')}</p>}
              <p className="ov-muted job-note">{t('jobs.payload.redactNote')}</p>
              {data.actions.payload.allowed ? (
                payload === null ? (
                  <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => void viewPayload()}>
                    {t('jobs.payload.view')}
                  </button>
                ) : payload.error ? (
                  <p className="scp-alert scp-alert-danger">{payload.error}</p>
                ) : (
                  <pre className="job-pre">{JSON.stringify(payload.value, null, 2)}</pre>
                )
              ) : (
                <p className="ov-muted">{t(`jobs.detail.reason.${data.actions.payload.reason ?? 'disabled'}`)}</p>
              )}
            </section>
            <section className="ov-card ov-section">
              <header className="ov-section-head">
                <h3>{t('jobs.result.title')}</h3>
              </header>
              {data.result ? (
                <>
                  <dl className="db-stat-grid db-stat-compact">
                    {row(t('jobs.result.status'), t('jobs.status.completed'))}
                    {row(t('jobs.col.duration'), formatMs(j.durationMs))}
                    {row(t('jobs.payload.size'), formatBytes(data.result.sizeBytes))}
                  </dl>
                  {data.result.truncated ? (
                    <p className="ov-muted">{t('jobs.result.tooLarge')}</p>
                  ) : (
                    <pre className="job-pre">{JSON.stringify(data.result.summary, null, 2)}</pre>
                  )}
                </>
              ) : (
                <p className="ov-empty-line">{j.status === 'completed' ? t('jobs.result.none') : t('jobs.result.notCompleted')}</p>
              )}
            </section>
          </>
        );
      case 'logs':
        return (
          <section className="ov-card ov-section">
            <header className="ov-section-head">
              <h3>{t('jobs.logs.title')}</h3>
              {data.logsMatchedBy && <span className="ov-section-hint">{t(`jobs.logs.by.${data.logsMatchedBy}`)}</span>}
            </header>
            <div className="log-viewer-stream rt-log-stream">
              {data.logs.length === 0 && <div className="rt-log-empty">{t('jobs.logs.none')}</div>}
              {data.logs.map((l, i) => (
                <div key={`${l.t}-${i}`} className="log-line">
                  <span className="log-time">{formatTime(l.t)}</span>
                  <span className={`log-chip level-${l.level === 'fatal' ? 'error' : l.level}`}>{l.level}</span>
                  {l.context && <span className="log-source">[{l.context}]</span>}
                  <span className="log-msg">{l.message}</span>
                </div>
              ))}
            </div>
            {data.jobLogs.length > 0 && (
              <>
                <h4>{t('jobs.logs.jobLog')}</h4>
                <pre className="job-pre">{data.jobLogs.join('\n')}</pre>
              </>
            )}
            <footer className="ov-section-foot">
              <button type="button" className="ov-link" onClick={() => navigate(logsPath)}>
                {t('jobs.logs.openViewer')} <ArrowRight size={13} />
              </button>
            </footer>
          </section>
        );
      case 'configuration':
        return (
          <>
            <section className="ov-card ov-section">
              <header className="ov-section-head">
                <h3>{t('jobs.detail.tab.configuration')}</h3>
              </header>
              <dl className="db-stat-grid">
                {row(t('jobs.col.type'), j.type)}
                {row(t('jobs.col.queue'), <code>{j.queue}</code>)}
                {row(t('jobs.config.maxAttempts'), data.config.maxAttempts)}
                {row(
                  t('jobs.config.backoff'),
                  data.config.backoff ? `${data.config.backoff.type} · ${formatMs(data.config.backoff.delayMs)}` : t('jobs.config.none'),
                )}
                {row(t('jobs.config.timeout'), t('jobs.config.noTimeout'))}
                {row(
                  t('jobs.col.priority'),
                  data.config.priority ? `${t(`jobs.priority.${data.config.priorityLevel}`)} (${data.config.priority})` : t('jobs.priority.normal'),
                )}
                {row(t('jobs.config.cancellable'), data.config.cancellable ? t('db.config.yes') : t('db.config.no'))}
                {row(t('jobs.detail.idempotency'), t(`jobs.idempotency.${data.idempotency.protection}`))}
                {row(t('jobs.config.idempotencyKey'), data.idempotency.key ? <code>{data.idempotency.key}</code> : NO_VALUE)}
                {row(t('jobs.config.removeOnComplete'), data.config.removeOnComplete ?? NO_VALUE)}
                {row(t('jobs.config.removeOnFail'), data.config.removeOnFail ?? NO_VALUE)}
                {row(t('jobs.config.lock'), formatMs(data.config.lockDurationMs))}
              </dl>
            </section>
            <section className="ov-card ov-section">
              <header className="ov-section-head">
                <h3>{t('jobs.handler.title')}</h3>
                <span className="ov-section-hint">{t('jobs.handler.hint')}</span>
              </header>
              <dl className="db-stat-grid">
                {row(t('jobs.handler.processor'), data.handler.processors.join(', ') || NO_VALUE)}
                {row(t('jobs.handler.runtime'), data.handler.runtimes.join(', ') || NO_VALUE)}
                {row(t('jobs.handler.instances'), data.handler.instances)}
                {row(t('jobs.handler.path'), <code>backend/src/apps/worker/processors</code>)}
              </dl>
            </section>
          </>
        );
      default:
        return (
          <>
            <div className="ov-kpi-grid sch-kpi-4 job-timing">
              <div className={`ov-card ov-kpi ${data.timing.diagnosis === 'wait' ? 'ov-tone-warn' : ''}`}>
                <span className="ov-kpi-label">{t('jobs.timing.wait')}</span>
                <span className="ov-kpi-value">{formatMs(data.timing.waitMs)}</span>
                <span className="ov-kpi-sub">
                  {t('jobs.timing.queueAvg', {
                    value: formatMs(data.timing.queueAvgWaitMs),
                  })}
                  {data.timing.waitDeviationPercent !== null &&
                    data.timing.waitDeviationPercent > 100 &&
                    ` · +${data.timing.waitDeviationPercent.toLocaleString()}%`}
                </span>
              </div>
              <div className={`ov-card ov-kpi ${data.timing.diagnosis === 'processing' || j.longRunning ? 'ov-tone-warn' : ''}`}>
                <span className="ov-kpi-label">{j.status === 'active' || j.status === 'stalled' ? t('jobs.timing.running') : t('jobs.timing.processing')}</span>
                <span className="ov-kpi-value">{formatMs(data.timing.processingMs)}</span>
                <span className="ov-kpi-sub">
                  {t('jobs.typical', {
                    value: formatMs(data.timing.typicalMs),
                  })}
                </span>
              </div>
              <div className="ov-card ov-kpi">
                <span className="ov-kpi-label">{t('jobs.timing.total')}</span>
                <span className="ov-kpi-value">{formatMs(data.timing.totalMs)}</span>
                <span className="ov-kpi-sub">{t('jobs.timing.totalSub')}</span>
              </div>
              <div className="ov-card ov-kpi">
                <span className="ov-kpi-label">{t('jobs.col.attempts')}</span>
                <span className="ov-kpi-value">{attemptsLabel(j)}</span>
                <span className="ov-kpi-sub">
                  {j.stalledCount > 0 ? t('jobs.detail.stalledCount', { count: j.stalledCount }) : t('jobs.detail.attemptsSub')}
                </span>
              </div>
            </div>
            {data.timing.diagnosis && <p className="msg-status-line ov-tone-warn">{t(`jobs.timing.diagnosis.${data.timing.diagnosis}`)}</p>}

            {j.progress && (
              <section className="ov-card ov-section">
                <header className="ov-section-head">
                  <h3>{t('jobs.progress.title')}</h3>
                </header>
                <JobProgressBar job={j} />
                <dl className="db-stat-grid db-stat-compact">
                  {j.progress.total !== null &&
                    row(t('jobs.progress.processed'), `${(j.progress.processed ?? 0).toLocaleString()} / ${j.progress.total.toLocaleString()}`)}
                  {j.progress.step && row(t('jobs.progress.step'), j.progress.step)}
                </dl>
                {j.progress.phases.length > 0 && (
                  <ul className="job-phases">
                    {j.progress.phases.map((p) => (
                      <li key={p.name} className={`is-${p.state}`}>
                        {p.state === 'done' ? '✓' : p.state === 'active' ? '●' : p.state === 'failed' ? '✕' : '○'} {p.name}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {failurePanel}

            <div className="ov-split db-split-even">
              <section className="ov-card ov-section">
                <header className="ov-section-head">
                  <h3>{t('jobs.detail.overview')}</h3>
                </header>
                <dl className="db-stat-grid">
                  {row(t('jobs.col.status'), <JobStatusChip status={j.status} />)}
                  {row(t('jobs.col.type'), j.type)}
                  {row(
                    t('jobs.col.queue'),
                    <button type="button" className="ov-link" onClick={() => navigate(`worker/queues/${encodeURIComponent(j.queue)}`)}>
                      <code>{j.queue}</code>
                    </button>,
                  )}
                  {row(
                    t('jobs.col.worker'),
                    j.worker ? (
                      <button type="button" className="ov-link" onClick={() => navigate('worker/workers')}>
                        {j.worker}
                      </button>
                    ) : (
                      NO_VALUE
                    ),
                  )}
                  {row(t('jobs.col.priority'), j.priority ? `${t(`jobs.priority.${j.priorityLevel}`)} (${j.priority})` : t('jobs.priority.normal'))}
                  {row(t('jobs.col.attempts'), attemptsLabel(j))}
                  {row(t('jobs.col.created'), at(j.createdAt))}
                  {j.availableAt &&
                    row(t('jobs.col.runAt'), `${at(j.availableAt)} · ${t('jobs.runsIn', { value: formatIn(secondsUntil(j.availableAt, now)) })}`)}
                  {row(t('jobs.detail.started'), at(j.startedAt))}
                  {row(t('jobs.detail.finished'), at(j.finishedAt))}
                  {j.cancelledAt && row(t('jobs.detail.cancelled'), `${at(j.cancelledAt)}${j.cancelledBy ? ` · ${j.cancelledBy}` : ''}`)}
                  {row(t('jobs.detail.idempotency'), t(`jobs.idempotency.${data.idempotency.protection}`))}
                </dl>
              </section>
              {sourcePanel}
            </div>

            {data.children.length > 0 && (
              <section className="ov-card ov-section">
                <header className="ov-section-head">
                  <h3>{t('jobs.tree.title')}</h3>
                </header>
                <p className="job-tree-root">
                  <strong>{j.type}</strong> <JobStatusChip status={j.status} />
                </p>
                <JobTable
                  rows={data.children}
                  columns={['id', 'type', 'queue', 'status', 'duration']}
                  now={now}
                  onOpen={(x) => openJob(x.id, x.queue)}
                  emptyText={t('jobs.tree.none')}
                />
              </section>
            )}
          </>
        );
    }
  };

  return (
    <>
      <button type="button" className="ov-link job-back" onClick={onBack}>
        <ArrowLeft size={13} /> {t('nav.jobs')}
      </button>
      <header className="ov-page-head job-detail-head">
        <div>
          <h1 className="ov-page-title">
            {j.type} <JobStatusChip status={j.status} large />
          </h1>
          <p className="ov-page-subtitle">
            <code>{j.id}</code>{' '}
            <button type="button" className="rt-icon-btn" aria-label={t('jobs.detail.copyId')} onClick={copyId}>
              <Copy size={12} />
            </button>
            {copied && <span className="ov-muted">{t('console.drawer.copied')}</span>}
          </p>
          <p className="job-detail-meta">
            {t('jobs.col.queue')}: <code>{j.queue}</code> • {t('jobs.col.worker')}: {j.worker ? instanceLabel(j.worker) : NO_VALUE} •{' '}
            {t('jobs.detail.attempt', { value: attemptsLabel(j) })}
          </p>
        </div>
        <div className="job-detail-side">
          <dl className="db-stat-grid db-stat-compact">
            {row(t('jobs.col.created'), formatTime(Date.parse(j.createdAt), true))}
            {row(t('jobs.detail.started'), j.startedAt ? formatTime(Date.parse(j.startedAt), true) : NO_VALUE)}
            {row(t('jobs.detail.finished'), j.finishedAt ? formatTime(Date.parse(j.finishedAt), true) : NO_VALUE)}
            {row(t('jobs.col.duration'), formatMs(j.status === 'active' || j.status === 'stalled' ? j.runningMs : j.durationMs))}
          </dl>
          <div className="job-actions-row">
            {actionBtn('retry', data.actions.retry, <RotateCcw size={13} />, 'scp-btn-primary', t('jobs.action.retry'))}
            {actionBtn(
              'cancel',
              data.actions.cancel,
              <Ban size={13} />,
              'scp-btn-secondary',
              data.actions.cancel.mode === 'cooperative' ? t('jobs.action.requestCancel') : t('jobs.action.cancel'),
            )}
            {actionBtn('remove', data.actions.remove, <Trash2 size={13} />, 'scp-btn-secondary', t('jobs.action.remove'))}
          </div>
          {!data.actions.retry.allowed && j.status === 'failed' && data.actions.retry.reason && (
            <p className="ov-muted job-note">{t(`jobs.detail.reason.${data.actions.retry.reason}`)}</p>
          )}
          {!data.actions.cancel.allowed && (j.status === 'active' || j.status === 'stalled') && data.actions.cancel.reason && (
            <p className="ov-muted job-note">{t(`jobs.detail.reason.${data.actions.cancel.reason}`)}</p>
          )}
        </div>
      </header>

      {j.status === 'stalled' && (
        <p className="msg-status-line ov-tone-crit">
          <AlertTriangle size={14} />{' '}
          {t('jobs.detail.stalledBanner', {
            value: data.stalled.heartbeatAgeSec !== null ? formatMs(data.stalled.heartbeatAgeSec * 1000) : t('jobs.detail.unknownAge'),
          })}{' '}
          <button type="button" className="ov-link" onClick={() => navigate('worker/workers')}>
            {t('jobs.detail.inspectWorker')}
          </button>
        </p>
      )}
      {data.longRunning.detected && (
        <p className="msg-status-line ov-tone-warn">
          <AlertTriangle size={14} />{' '}
          {t('jobs.detail.longRunningBanner', {
            running: formatMs(data.longRunning.runningMs),
            typical: formatMs(data.timing.typicalMs),
          })}
        </p>
      )}
      {j.longWait && (
        <p className="msg-status-line ov-tone-warn">
          <AlertTriangle size={14} /> {t('jobs.detail.longWaitBanner', { wait: formatMs(j.waitMs) })}{' '}
          <button type="button" className="ov-link" onClick={() => navigate(`worker/queues/${encodeURIComponent(j.queue)}`)}>
            {t('jobs.detail.openQueue')}
          </button>
        </p>
      )}
      {j.status === 'cancelled' && j.cancelledAt && (
        <p className="msg-status-line">
          {t('jobs.detail.cancelledBanner', {
            time: formatRelative(new Date(j.cancelledAt), now),
          })}
        </p>
      )}

      <nav className="rt-tabs" role="tablist" aria-label={t('jobs.detail.tabs')}>
        {JOB_DETAIL_TABS.map((x) => (
          <button key={x} type="button" role="tab" aria-selected={sub === x} className={sub === x ? 'is-active' : ''} onClick={() => onSub(x)}>
            {t(`jobs.detail.tab.${x}`)}
            {x === 'attempts' && data.attempts.length > 1 && <span className="ov-count">{data.attempts.length}</span>}
          </button>
        ))}
      </nav>
      {renderSub()}
    </>
  );
};

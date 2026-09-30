import React from 'react';
import { ExternalLink, FileText, Layers, Play } from 'lucide-react';
import type { Execution, TaskRow } from '../../types/scheduler.types';
import type { MessageStatus } from '../../types/messaging.types';
import { MESSAGE_STATUS_TONE } from '../../constants/messaging';
import type { TaskAction } from '../../hooks/useSchedulerActions';
import { schedulerApi } from '../../services/scheduler.api';
import { usePolling } from '../../hooks/usePolling';
import { DbDrawer } from '../database/DbDrawer';
import { formatCompact } from '../../utils/database-format';
import { formatMs, shortJobId } from '../../utils/worker-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { ExecutionStatusChip } from './TaskStatus';
import { useLocale } from '../../../../core/i18n/index';

/**
 * Execution Detail: lịch vs thực tế (drift), kết quả / lỗi, instance, correlation ID → log; job đã tạo và trạng thái
 * hiện tại (trigger thành công ≠ job thành công) → Messaging / Queue. Run Again dùng cùng quy tắc với Run Now.
 */
export const ExecutionDrawer: React.FC<{
  id: string;
  now: number;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onOpenExecution: (id: string) => void;
  onAction?: (action: TaskAction, task: TaskRow) => void;
  navigate: (path: string) => void;
}> = ({ id, now, onClose, onOpenTask, onOpenExecution, onAction, navigate }) => {
  const { t, formatTime, formatRelative, locale } = useLocale();
  const { data, error } = usePolling(() => schedulerApi.execution(id), `sch-exec:${id}`, 5000);
  const e = data?.execution;
  const at = (v: string | null) =>
    v ? (
      <>
        {new Date(v).toLocaleDateString()} {formatTime(Date.parse(v), true)}.{String(new Date(v).getMilliseconds()).padStart(3, '0')}
      </>
    ) : (
      NO_VALUE
    );
  const row = (label: string, value: React.ReactNode) => (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
  const blocking = (b: Execution) => (
    <button type="button" className="ov-link" onClick={() => onOpenExecution(b.id)}>
      <code>{b.id}</code> · {b.startedAt ? formatRelative(new Date(b.startedAt), now) : NO_VALUE}
    </button>
  );
  return (
    <DbDrawer title={<code>{t('sch.exec.title', { id })}</code>} meta={e ? e.taskName : undefined} onClose={onClose}>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {e && data && (
        <>
          <p className={`msg-status-line`}>
            <ExecutionStatusChip exec={e} />
            <span>{t(`sch.exec.statusHint.${e.status}`)}</span>
          </p>
          <dl className="db-stat-grid">
            {row(
              t('sch.exec.col.task'),
              <button type="button" className="ov-link" onClick={() => onOpenTask(e.taskId)}>
                {e.taskName}
              </button>,
            )}
            {row(t('sch.exec.col.trigger'), t(`sch.exec.trigger.${e.trigger}`))}
            {row(t('sch.exec.scheduledAt'), at(e.scheduledAt))}
            {row(t('sch.exec.startedAt'), at(e.startedAt))}
            {row(t('sch.exec.finishedAt'), at(e.finishedAt))}
            {row(t('sch.exec.col.duration'), e.status === 'running' ? formatMs(e.runningMs) : formatMs(e.durationMs))}
            {row(t('sch.exec.col.drift'), e.driftMs === null ? NO_VALUE : formatMs(e.driftMs))}
            {row(t('sch.exec.col.instance'), e.instance ? <code>{e.instance}</code> : NO_VALUE)}
            {row(t('sch.exec.correlation'), e.correlationId ? <code>{e.correlationId}</code> : NO_VALUE)}
            {e.actor !== null && row(t('sch.exec.actor'), e.actor)}
          </dl>

          {e.longRunning && <p className="msg-status-line ov-tone-warn">{t('sch.exec.longRunningNote')}</p>}

          {e.error && (
            <section className="sch-failure">
              <h4>{t('sch.exec.failedTitle')}</h4>
              <dl className="db-stat-grid db-stat-compact">
                {row(t('sch.exec.errorType'), <code>{e.error.type}</code>)}
                {row(t('sch.exec.col.duration'), formatMs(e.durationMs))}
              </dl>
              <pre className="sch-error-message">{e.error.message}</pre>
            </section>
          )}

          {e.status === 'missed' && (
            <p className="msg-status-line ov-tone-warn">
              {t('sch.exec.missedNote', {
                count: e.missedCount ?? 1,
                from: e.scheduledAt ? new Date(e.scheduledAt).toLocaleString() : NO_VALUE,
                until: e.missedUntil ? new Date(e.missedUntil).toLocaleString() : NO_VALUE,
              })}
            </p>
          )}
          {e.status === 'skipped' && (
            <p className="msg-status-line ov-tone-unknown">
              {t('sch.exec.skippedNote', { reason: e.reason ? t(`sch.reason.${e.reason}`) : NO_VALUE })}
              {data.blocking && <> · {blocking(data.blocking)}</>}
            </p>
          )}

          <h4>{t('sch.exec.jobs')}</h4>
          {e.jobs.length === 0 ? (
            <p className="ov-empty-line">{e.status === 'success' || e.status === 'failed' ? t('sch.exec.noJobs') : NO_VALUE}</p>
          ) : (
            <>
              <p className="pf-chart-note">{t('sch.exec.jobsNote')}</p>
              <div className="scp-table-wrap">
                <table className="scp-table">
                  <thead>
                    <tr>
                      <th>{t('sch.exec.job.id')}</th>
                      <th>{t('sch.exec.job.queue')}</th>
                      <th>{t('sch.exec.job.state')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.jobs.map((j) => (
                      <tr key={j.id} className="is-clickable" onClick={() => navigate(`messaging/messages/${encodeURIComponent(j.id)}?q=${encodeURIComponent(j.queue)}`)}>
                        <td>
                          <code title={j.id}>#{shortJobId(j.id)}</code>
                          <small className="pf-row-note">{j.topic}</small>
                        </td>
                        <td>
                          <code>{j.queue}</code>
                        </td>
                        <td>
                          {j.status ? <span className={`pf-chip ov-tone-${MESSAGE_STATUS_TONE[j.status as MessageStatus] ?? 'unknown'}`}>{t(`messaging.status.${j.status}`)}</span> : NO_VALUE}
                          {j.error && <small className="pf-row-note wq-error">{j.error}</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data.jobsReason && <p className="pf-chart-note">{data.jobsReason}</p>}
            </>
          )}

          {data.downstream && (
            <>
              <h4>{t('sch.downstream.title')}</h4>
              {data.downstream.state ? (
                <dl className="db-stat-grid db-stat-compact">
                  {row(t('wq.queue.name'), <code>{data.downstream.queue}</code>)}
                  {row(t('wq.queue.waiting'), formatCompact(data.downstream.state.waiting, locale))}
                  {row(t('wq.queue.failed'), formatCompact(data.downstream.state.failed, locale))}
                </dl>
              ) : (
                <p className="ov-empty-line">
                  <code>{data.downstream.queue}</code> · {data.downstream.reason}
                </p>
              )}
            </>
          )}

          <div className="cache-drawer-actions">
            {e.correlationId && (
              <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate(`logs?runtime=scheduler&correlationId=${encodeURIComponent(e.correlationId!)}`)}>
                <FileText size={13} /> {t('sch.exec.openLogs')}
              </button>
            )}
            {(data.downstream?.queue ?? e.jobs[0]?.queue) && (
              <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate(`worker/queues/${encodeURIComponent(data.downstream?.queue ?? e.jobs[0]!.queue)}`)}>
                <Layers size={13} /> {t('sch.exec.openQueue')}
              </button>
            )}
            <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate('runtimes/scheduler')}>
              <ExternalLink size={13} /> {t('sch.exec.openRuntime')}
            </button>
            {onAction && data.task && data.settings.run && e.status !== 'running' && (
              <button type="button" className="scp-btn scp-btn-sm scp-btn-primary" onClick={() => onAction('run', data.task!)}>
                <Play size={13} /> {t('sch.exec.runAgain')}
              </button>
            )}
          </div>
        </>
      )}
    </DbDrawer>
  );
};

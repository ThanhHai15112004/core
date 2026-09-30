import React from 'react';
import type { JobRow } from '../../types/jobs.types';
import type { JobColumn } from '../../constants/jobs';
import { formatMs, shortJobId } from '../../utils/worker-format';
import { formatIn, secondsUntil } from '../../utils/scheduler-format';
import { attemptsLabel, jobDuration, sourceDetail } from '../../utils/jobs-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { JobProgressBar, JobStatusChip } from './JobStatus';
import { useLocale } from '../../../../core/i18n/index';

export const JobTable: React.FC<{
  rows: JobRow[];
  columns: JobColumn[];
  now: number;
  onOpen: (j: JobRow) => void;
  emptyText: string;
  /** Chọn nhiều (retry hàng loạt job lỗi). */
  selected?: ReadonlySet<string>;
  onToggle?: (j: JobRow) => void;
  onToggleAll?: (rows: JobRow[], on: boolean) => void;
  canSelect?: (j: JobRow) => boolean;
}> = ({ rows, columns, now, onOpen, emptyText, selected, onToggle, onToggleAll, canSelect = () => true }) => {
  const { t, formatTime, formatRelative } = useLocale();
  if (rows.length === 0) return <p className="ov-empty-line">{emptyText}</p>;
  const selectable = rows.filter(canSelect);
  const allOn = selected && selectable.length > 0 && selectable.every((j) => selected.has(`${j.queue}|${j.id}`));
  const cell = (j: JobRow, c: JobColumn): React.ReactNode => {
    switch (c) {
      case 'id':
        return <code title={j.id}>#{shortJobId(j.id)}</code>;
      case 'type':
        return <strong className="job-type">{j.type}</strong>;
      case 'queue':
        return <code>{j.queue}</code>;
      case 'status':
        return (
          <>
            <JobStatusChip status={j.status} />
            {j.longRunning && <small className="pf-row-note is-warn">{t('jobs.flag.longRunning')}</small>}
            {j.longWait && <small className="pf-row-note is-warn">{t('jobs.flag.longWait')}</small>}
          </>
        );
      case 'wait':
        return <span className={j.longWait ? 'is-warn' : ''}>{j.status === 'delayed' ? NO_VALUE : `${formatMs(j.waitMs)}${j.longWait ? ' ⚠' : ''}`}</span>;
      case 'duration':
        return formatMs(jobDuration(j));
      case 'attempts':
        return attemptsLabel(j);
      case 'created':
        return formatTime(Date.parse(j.createdAt), true);
      case 'source': {
        const d = sourceDetail(j.source);
        return (
          <>
            {t(`jobs.source.${j.source.kind}`)}
            {d && <small className="pf-row-note">{d}</small>}
          </>
        );
      }
      case 'worker':
        return j.worker ?? NO_VALUE;
      case 'priority':
        return j.priority ? `${t(`jobs.priority.${j.priorityLevel}`)} (${j.priority})` : t('jobs.priority.normal');
      case 'running':
        return (
          <span className={j.longRunning || j.status === 'stalled' ? 'is-warn' : ''}>
            {formatMs(j.runningMs)}
            {j.longRunning && j.typicalMs !== null && <small className="pf-row-note">{t('jobs.typical', { value: formatMs(j.typicalMs) })}</small>}
          </span>
        );
      case 'progress':
        return <JobProgressBar job={j} compact />;
      case 'heartbeat':
        return j.heartbeatAgeSec !== null ? (
          t('jobs.heartbeatAgo', { value: formatMs(j.heartbeatAgeSec * 1000) })
        ) : (
          <span className="is-warn">{t('jobs.noHeartbeat')}</span>
        );
      case 'runAt':
        return j.availableAt ? (
          <>
            {formatTime(Date.parse(j.availableAt), true)}
            <small className="pf-row-note">
              {t('jobs.runsIn', {
                value: formatIn(secondsUntil(j.availableAt, now)),
              })}
            </small>
          </>
        ) : (
          NO_VALUE
        );
      case 'reason':
        return j.delayReason ? t(`wq.delayed.reason.${j.delayReason}`) : NO_VALUE;
      case 'error':
        return j.errorType ? (
          <>
            <code className={j.status === 'failed' ? 'job-error' : ''}>{j.errorType}</code>
            {j.retryable === false && <small className="pf-row-note is-warn">{t('jobs.retryable.no')}</small>}
          </>
        ) : (
          NO_VALUE
        );
      case 'finished':
        return j.finishedAt ? formatRelative(new Date(j.finishedAt), now) : NO_VALUE;
      case 'cancelled':
        return j.cancelledAt ? (
          <>
            {formatRelative(new Date(j.cancelledAt), now)}
            {j.cancelledBy && <small className="pf-row-note">{j.cancelledBy}</small>}
          </>
        ) : (
          NO_VALUE
        );
    }
  };
  return (
    <div className="scp-table-wrap">
      <table className="scp-table job-table">
        <thead>
          <tr>
            {onToggle && (
              <th className="job-select">
                <input
                  type="checkbox"
                  aria-label={t('jobs.select.all')}
                  checked={!!allOn}
                  disabled={!selectable.length}
                  onChange={(e) => onToggleAll?.(selectable, e.target.checked)}
                />
              </th>
            )}
            {columns.map((c) => (
              <th key={c}>{t(`jobs.col.${c}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((j) => {
            const key = `${j.queue}|${j.id}`;
            return (
              <tr key={key} className={`is-clickable ${j.status === 'stalled' ? 'is-warn-row' : ''}`} onClick={() => onOpen(j)}>
                {onToggle && (
                  <td className="job-select" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={t('jobs.select.one', {
                        id: shortJobId(j.id),
                      })}
                      disabled={!canSelect(j)}
                      checked={selected?.has(key) ?? false}
                      onChange={() => onToggle(j)}
                    />
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c}>{cell(j, c)}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

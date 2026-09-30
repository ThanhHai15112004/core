import React from 'react';
import type { JobRow } from '../../types/worker.types';
import { JOB_STATE_ICON, JOB_STATE_TONE } from '../../constants/worker';
import { formatMs, shortJobId } from '../../utils/worker-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

export type JobColumn = 'id' | 'queue' | 'type' | 'state' | 'attempt' | 'duration' | 'running' | 'runAt' | 'reason' | 'worker' | 'error' | 'time';

/**
 * Bảng job (tóm tắt): chưa có Job Explorer riêng nên bấm job → mở chi tiết ở Messaging (cùng một job trên broker,
 * có vòng đời và thao tác retry/replay).
 */
export const JobTable: React.FC<{ rows: JobRow[]; columns: JobColumn[]; onOpen?: (job: JobRow) => void; emptyText: string; now: number }> = ({
  rows,
  columns,
  onOpen,
  emptyText,
  now,
}) => {
  const { t, formatTime, formatRelative } = useLocale();
  if (rows.length === 0) return <p className="ov-empty-line">{emptyText}</p>;
  const cell = (j: JobRow, c: JobColumn): React.ReactNode => {
    switch (c) {
      case 'id':
        return <code title={j.id}>#{shortJobId(j.id)}</code>;
      case 'queue':
        return <code>{j.queue}</code>;
      case 'type':
        return <code>{j.name}</code>;
      case 'state':
        return (
          <span className={`pf-chip ov-tone-${JOB_STATE_TONE[j.state]}`}>
            {JOB_STATE_ICON[j.state]} {t(`wq.job.state.${j.state}`)}
          </span>
        );
      case 'attempt':
        return `${j.attempts}/${j.maxAttempts}`;
      case 'duration':
        return j.state === 'active' ? formatMs(j.runningMs) : formatMs(j.durationMs);
      case 'running':
        return formatMs(j.runningMs);
      case 'runAt':
        return j.runAt ? (
          <>
            {formatTime(Date.parse(j.runAt), true)}
            <small className="pf-row-note">{formatRelative(new Date(j.runAt), now)}</small>
          </>
        ) : (
          NO_VALUE
        );
      case 'reason':
        return j.delayReason ? t(`wq.delayed.reason.${j.delayReason}`) : NO_VALUE;
      case 'worker':
        return j.worker ?? NO_VALUE;
      case 'error':
        return j.error ? <span className="wq-error">{j.error}</span> : NO_VALUE;
      case 'time': {
        const at = j.finishedAt ?? j.processedAt ?? j.createdAt;
        return formatTime(Date.parse(at), true);
      }
    }
  };
  return (
    <div className="scp-table-wrap">
      <table className="scp-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{t(`wq.job.col.${c}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((j) => (
            <tr key={`${j.queue}-${j.id}`} className={onOpen ? 'is-clickable' : ''} onClick={onOpen ? () => onOpen(j) : undefined}>
              {columns.map((c) => (
                <td key={c} className={c === 'error' ? 'cache-key-cell' : ''}>
                  {cell(j, c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

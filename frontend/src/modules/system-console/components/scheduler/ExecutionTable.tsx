import React from 'react';
import type { Execution } from '../../types/scheduler.types';
import { formatMs } from '../../utils/worker-format';
import { shortExecId } from '../../utils/scheduler-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { ExecutionStatusChip } from './TaskStatus';
import { useLocale } from '../../../../core/i18n/index';

export type ExecColumn = 'time' | 'task' | 'result' | 'duration' | 'trigger' | 'error' | 'id';

/** Lịch sử thực thi: thời điểm, task, kết quả, thời lượng, trigger (bấm → Execution Detail). */
export const ExecutionTable: React.FC<{ rows: Execution[]; columns: ExecColumn[]; onOpen: (e: Execution) => void; emptyText: string }> = ({
  rows,
  columns,
  onOpen,
  emptyText,
}) => {
  const { t, formatTime } = useLocale();
  if (rows.length === 0) return <p className="ov-empty-line">{emptyText}</p>;
  const cell = (e: Execution, c: ExecColumn): React.ReactNode => {
    switch (c) {
      case 'time': {
        const at = e.startedAt ?? e.scheduledAt ?? e.finishedAt;
        return at ? (
          <>
            {formatTime(Date.parse(at), true)}
            <small className="pf-row-note">{new Date(at).toLocaleDateString()}</small>
          </>
        ) : (
          NO_VALUE
        );
      }
      case 'task':
        return <span className="cell-strong">{e.taskName}</span>;
      case 'result':
        return (
          <>
            <ExecutionStatusChip exec={e} />
          </>
        );
      case 'duration':
        return e.status === 'running' ? (
          <span>{formatMs(e.runningMs)}</span>
        ) : (
          formatMs(e.durationMs)
        );
      case 'trigger':
        return t(`sch.exec.trigger.${e.trigger}`);
      case 'error':
        return e.error ? (
          <span className="wq-error">
            <code>{e.error.type}</code> {e.error.message}
          </span>
        ) : (
          NO_VALUE
        );
      case 'id':
        return <code title={e.id}>{shortExecId(e.id)}</code>;
    }
  };
  return (
    <div className="scp-table-wrap">
      <table className="scp-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{t(`sch.exec.col.${c}`)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="is-clickable" onClick={() => onOpen(e)}>
              {columns.map((c) => (
                <td key={c} className={c === 'error' ? 'cache-key-cell' : ''}>
                  {cell(e, c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

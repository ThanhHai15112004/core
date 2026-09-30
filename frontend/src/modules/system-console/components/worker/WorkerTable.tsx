import React from 'react';
import type { WorkerRow } from '../../types/worker.types';
import { WORKER_STATUS_TONE } from '../../constants/worker';
import { formatMb, formatUptime, NO_VALUE } from '../../utils/runtime-format';
import { instanceLabel } from '../../utils/worker-format';
import { useLocale } from '../../../../core/i18n/index';

/** Worker instance: trạng thái, job đang chạy / concurrency, CPU, bộ nhớ, uptime, queue tiêu thụ. */
export const WorkerTable: React.FC<{ rows: WorkerRow[]; onOpen: (id: string) => void; emptyText: string }> = ({ rows, onOpen, emptyText }) => {
  const { t } = useLocale();
  if (rows.length === 0) return <p className="ov-empty-line">{emptyText}</p>;
  return (
    <div className="scp-table-wrap">
      <table className="scp-table cache-ns-table">
        <thead>
          <tr>
            <th>{t('wq.worker.name')}</th>
            <th>{t('wq.worker.status')}</th>
            <th>{t('wq.worker.active')}</th>
            <th>CPU</th>
            <th>{t('wq.worker.memory')}</th>
            <th>{t('wq.worker.uptime')}</th>
            <th>{t('wq.worker.queues')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id} className="is-clickable" onClick={() => onOpen(w.id)}>
              <td>
                <code>{instanceLabel(w.id)}</code>
                <small className="pf-row-note">{w.runtime ? t(`rt.name.${w.runtime}`) : NO_VALUE}</small>
              </td>
              <td>
                <span className={`pf-chip ov-tone-${WORKER_STATUS_TONE[w.status]}`}>{t(`wq.worker.statusOf.${w.status}`)}</span>
              </td>
              <td className={w.active > w.concurrency ? 'is-crit' : ''}>
                {w.active} / {w.concurrency}
                {w.utilizationPercent !== null && <small className="pf-row-note">{w.utilizationPercent}%</small>}
              </td>
              <td className={w.status === 'high_cpu' ? 'is-warn' : ''}>{w.cpuPercent === null ? NO_VALUE : `${w.cpuPercent}%`}</td>
              <td className={w.status === 'high_memory' ? 'is-warn' : ''}>
                {formatMb(w.memoryMb)}
                {w.memoryLimitMb !== null && <small className="pf-row-note">/ {formatMb(w.memoryLimitMb)}</small>}
              </td>
              <td>{formatUptime(w.uptimeSec)}</td>
              <td>{w.queues.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

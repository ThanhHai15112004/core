import React from 'react';
import type { OperationRow, TransferPerf } from '../../types/storage.types';
import { formatBytes } from '../../utils/database-format';
import { formatUnit } from '../../utils/performance-format';
import { formatRate } from '../../utils/storage-format';
import { useLocale } from '../../../../core/i18n/index';

/** Hiệu năng một chiều (upload / download): throughput, số lượt, avg/P95, lỗi. */
export const TransferPerfCard: React.FC<{ dir: 'upload' | 'download'; perf: TransferPerf }> = ({ dir, perf }) => {
  const { t } = useLocale();
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t(`storage.transfer.${dir}`)}</h3>
      </header>
      <p className="db-pool-big">{formatRate(perf.bytesPerSec)}</p>
      <dl className="db-stat-grid db-stat-compact">
        <div>
          <dt>{t('storage.transfer.ops')}</dt>
          <dd>{formatUnit(perf.opsPerMin, '/min')}</dd>
        </div>
        <div>
          <dt>{t('storage.transfer.avg')}</dt>
          <dd>{formatUnit(perf.avgMs, 'ms')}</dd>
        </div>
        <div>
          <dt>P95</dt>
          <dd>{formatUnit(perf.p95Ms, 'ms')}</dd>
        </div>
        <div>
          <dt>{t('storage.transfer.failures')}</dt>
          <dd className={perf.failures > 0 ? 'is-warn' : ''}>
            {perf.failures}
            {perf.failureRatePercent !== null && perf.failures > 0 ? ` (${formatUnit(perf.failureRatePercent, '%')})` : ''}
          </dd>
        </div>
        <div>
          <dt>{t('storage.transfer.total')}</dt>
          <dd>{formatBytes(perf.bytes)}</dd>
        </div>
      </dl>
    </section>
  );
};

/** Bảng theo thao tác (PUT/GET/DELETE/HEAD/LIST; local gọi là Write/Read/Delete/Stat/List). */
export const OperationsTable: React.FC<{ rows: OperationRow[]; driver: string }> = ({ rows, driver }) => {
  const { t } = useLocale();
  return (
    <div className="scp-table-wrap">
      <table className="scp-table">
        <thead>
          <tr>
            <th>{t('storage.ops.op')}</th>
            <th>{t('storage.ops.perMin')}</th>
            <th>{t('storage.ops.total')}</th>
            <th>{t('storage.transfer.avg')}</th>
            <th>P95</th>
            <th>{t('storage.transfer.failures')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.op}>
              <th>{t(`storage.ops.name.${driver === 'local' ? 'local' : 's3'}.${r.op}`)}</th>
              <td>{formatUnit(r.perMin, '/min')}</td>
              <td>{r.ops}</td>
              <td>{formatUnit(r.avgMs, 'ms')}</td>
              <td>{formatUnit(r.p95Ms, 'ms')}</td>
              <td className={r.failures > 0 ? 'is-warn' : ''}>{r.failures}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

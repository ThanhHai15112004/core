import React from 'react';
import type { RuntimeSummary } from '../../types/runtime.types';
import { formatMb, formatMetric, formatUptime, NO_VALUE, percent } from '../../utils/runtime-format';
import { RuntimeStatusBadge } from './RuntimeStatusBadge';
import { useLocale } from '../../../../core/i18n/index';

/** Lỗi đặc thù từng runtime (API: tỷ lệ lỗi, Worker: job lỗi, Scheduler: task lỗi hôm nay). */
const ERROR_METRIC: Record<string, { key: string; unit?: string }> = {
  api: { key: 'errorRatePercent', unit: '%' },
  worker: { key: 'failedJobs' },
  scheduler: { key: 'failedToday' },
};

export const RuntimeComparisonTable: React.FC<{ runtimes: RuntimeSummary[]; onNavigate: (path: string) => void }> = ({
  runtimes,
  onNavigate,
}) => {
  const { t } = useLocale();
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('rt.comparison.title')}</h3>
      </header>
      <div className="scp-table-wrap">
        <table className="scp-table">
          <thead>
            <tr>
              <th>{t('rt.comparison.runtime')}</th>
              <th>{t('rt.comparison.status')}</th>
              <th>{t('rt.metric.cpu')}</th>
              <th>{t('rt.metric.memory')}</th>
              <th>{t('rt.metric.uptime')}</th>
              <th>{t('rt.comparison.errors')}</th>
              <th>{t('rt.comparison.restarts')}</th>
            </tr>
          </thead>
          <tbody>
            {runtimes.map((r) => {
              const err = ERROR_METRIC[r.id];
              return (
                <tr key={r.id} className="rt-row-link" onClick={() => onNavigate(`runtimes/${r.id}`)}>
                  <td className="cell-strong">{r.name}</td>
                  <td>
                    <RuntimeStatusBadge status={r.status} size="sm" />
                  </td>
                  <td>{r.resources ? percent(r.resources.cpuPercent) : NO_VALUE}</td>
                  <td>{r.resources ? formatMb(r.resources.rssMb) : NO_VALUE}</td>
                  <td>{formatUptime(r.uptimeSec)}</td>
                  <td>{err ? formatMetric(r.metrics[err.key], err.unit) : NO_VALUE}</td>
                  <td>{r.restartCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};

import React from 'react';
import type { JobsRange, JobsReport } from '../../types/jobs.types';
import { jobsApi } from '../../services/jobs.api';
import { usePolling } from '../../hooks/usePolling';
import { formatCompact } from '../../utils/database-format';
import { formatMs } from '../../utils/worker-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

type Explore = (f: Record<string, string | number | undefined>) => void;
const ROWS: (keyof JobsReport)[] = [
  'created',
  'completed',
  'failed',
  'retried',
  'successRatePercent',
  'avgWaitMs',
  'avgProcessingMs',
  'p95ProcessingMs',
];

/** Jobs Report hôm nay vs hôm qua + hiệu năng theo loại job (loại nào chậm / hay lỗi) + top loại job. */
export const JobsPerformanceView: React.FC<{
  range: JobsRange;
  paused: boolean;
  reloadKey: number;
  now: number;
  explore: Explore;
}> = ({ range, paused, reloadKey, explore }) => {
  const { t, locale } = useLocale();
  const { data, error } = usePolling(() => jobsApi.report(range), `jobs-report:${range}:${reloadKey}`, 30_000, paused);
  const fmt = (k: keyof JobsReport, v: number | null) =>
    v === null ? NO_VALUE : k === 'successRatePercent' ? `${v}%` : k.endsWith('Ms') ? formatMs(v) : formatCompact(v, locale);
  const top = data ? [...data.types].sort((a, b) => b.created - a.created).slice(0, 5) : [];
  const maxTop = Math.max(1, ...top.map((x) => x.created));
  return (
    <>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('jobs.report.title')}</h3>
          </header>
          <div className="scp-table-wrap">
            <table className="scp-table tr-kv-table">
              <thead>
                <tr>
                  <th />
                  <th>{t('jobs.report.today')}</th>
                  <th>{t('jobs.report.yesterday')}</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map((k) => (
                  <tr key={k}>
                    <th>{t(`jobs.report.${k}`)}</th>
                    <td>{data ? fmt(k, data.today[k]) : NO_VALUE}</td>
                    <td className="ov-muted">{data ? fmt(k, data.yesterday[k]) : NO_VALUE}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('jobs.report.topTypes')}</h3>
            <span className="ov-section-hint">{t(`tr.range.${range}`)}</span>
          </header>
          {top.length === 0 ? (
            <p className="ov-empty-line">{t('jobs.report.noTypes')}</p>
          ) : (
            <ul className="job-top-types">
              {top.map((x) => (
                <li key={x.type}>
                  <button type="button" className="ov-link" onClick={() => explore({ type: x.type })}>
                    {x.type}
                  </button>
                  <span className="job-bar-cell">
                    <span className="job-bar" style={{ width: `${(x.created / maxTop) * 100}%` }} />
                    <span>{formatCompact(x.created, locale)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('jobs.types.title')}</h3>
          <span className="ov-section-hint">{t(`tr.range.${range}`)}</span>
        </header>
        {data && data.types.length === 0 ? (
          <p className="ov-empty-line">{t('jobs.report.noTypes')}</p>
        ) : (
          <div className="scp-table-wrap">
            <table className="scp-table">
              <thead>
                <tr>
                  <th>{t('jobs.types.col.type')}</th>
                  <th>{t('jobs.types.col.created')}</th>
                  <th>{t('jobs.types.col.runs')}</th>
                  <th>{t('jobs.types.col.avg')}</th>
                  <th>P95</th>
                  <th>{t('jobs.types.col.failure')}</th>
                </tr>
              </thead>
              <tbody>
                {data?.types.map((x) => (
                  <tr key={x.type} className="is-clickable" onClick={() => explore({ type: x.type })}>
                    <td>
                      <strong className="job-type">{x.type}</strong>
                    </td>
                    <td>{formatCompact(x.created, locale)}</td>
                    <td>{formatCompact(x.runs, locale)}</td>
                    <td>{formatMs(x.avgMs)}</td>
                    <td>{formatMs(x.p95Ms)}</td>
                    <td className={(x.failureRatePercent ?? 0) >= 5 ? 'is-warn' : ''}>
                      {x.failureRatePercent === null ? NO_VALUE : `${x.failureRatePercent}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
};

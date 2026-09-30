import React, { useState } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { JobsRange } from '../../types/jobs.types';
import { jobsApi } from '../../services/jobs.api';
import { usePolling } from '../../hooks/usePolling';
import { FailureGroups } from '../../components/jobs/FailureGroups';
import { DEPENDENCY_PATH } from '../../constants/jobs';
import { formatCompact } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

type Explore = (f: Record<string, string | number | undefined>) => void;

/**
 * Failed Jobs: lỗi hôm nay, tỉ lệ lỗi, retry được / không, nhóm lỗi (bấm → danh sách job của nhóm), retry storm (kèm
 * loại job / lỗi chính và trang hạ tầng liên quan).
 */
export const JobsFailuresView: React.FC<{
  range: JobsRange;
  paused: boolean;
  reloadKey: number;
  now: number;
  queues: string[];
  explore: Explore;
  openJob: (id: string, queue?: string | null) => void;
  navigate: (path: string) => void;
}> = ({ range, paused, reloadKey, now, queues, explore, navigate }) => {
  const { t, locale } = useLocale();
  const [queue, setQueue] = useState('');
  const { data, error } = usePolling(() => jobsApi.failures(range, queue || undefined), `jobs-failures:${range}:${queue}:${reloadKey}`, undefined, paused);
  const n = (v: number | null) => formatCompact(v, locale);
  const s = data?.stats;
  const storm = data?.retryStorm;
  const stormDep = storm && data?.groups.available ? data.groups.data.find((g) => g.errorType === storm.primaryError)?.dependency : null;
  return (
    <>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {storm && (
        <section className="ov-card ov-section ov-tone-crit job-storm">
          <h3>
            <AlertTriangle size={16} /> {t('jobs.storm.title')}
          </h3>
          <p>{t('jobs.storm.message', { count: storm.retriesPerMin })}</p>
          <dl className="db-stat-grid db-stat-compact">
            <div>
              <dt>{t('jobs.storm.type')}</dt>
              <dd>{storm.primaryType ?? NO_VALUE}</dd>
            </div>
            <div>
              <dt>{t('jobs.storm.error')}</dt>
              <dd>{storm.primaryError ?? NO_VALUE}</dd>
            </div>
          </dl>
          <div className="job-actions-row">
            <button
              type="button"
              className="scp-btn scp-btn-sm scp-btn-secondary"
              onClick={() =>
                explore({
                  status: 'retrying',
                  errorType: storm.primaryError ?? undefined,
                })
              }
            >
              {t('jobs.storm.inspect')}
            </button>
            {stormDep && DEPENDENCY_PATH[stormDep] && (
              <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate(DEPENDENCY_PATH[stormDep]!)}>
                {t('jobs.dependency.open', {
                  name: t(`jobs.dependency.${stormDep}`),
                })}{' '}
                <ArrowRight size={12} />
              </button>
            )}
          </div>
        </section>
      )}

      <div className="ov-kpi-grid sch-kpi-4">
        {[
          {
            key: 'failedToday',
            value: n(s?.failedToday ?? null),
            sub: t('jobs.failures.kpi.failedTodaySub', {
              count: n(s?.failedNow ?? null),
            }),
            filter: { status: 'failed', window: '24h' },
          },
          {
            key: 'failureRate',
            value: s?.failureRatePercent === null || !s ? NO_VALUE : `${s.failureRatePercent}%`,
            sub: t(`tr.range.${range}`),
            filter: { status: 'failed' },
          },
          {
            key: 'retryable',
            value: n(s?.retryable ?? null),
            sub: t('jobs.failures.kpi.retryableSub'),
            filter: { status: 'failed' },
          },
          {
            key: 'nonRetryable',
            value: n(s?.nonRetryable ?? null),
            sub: t('jobs.failures.kpi.nonRetryableSub', {
              count: n(s?.retryingNow ?? null),
            }),
            filter: { status: 'retrying' },
          },
        ].map((k) => (
          <button key={k.key} type="button" className="ov-card ov-kpi job-kpi" onClick={() => explore(k.filter)}>
            <span className="ov-kpi-label">{t(`jobs.failures.kpi.${k.key}`)}</span>
            <span className="ov-kpi-value">{k.value}</span>
            <span className="ov-kpi-sub">{k.sub}</span>
          </button>
        ))}
      </div>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('jobs.failures.groups')}</h3>
          <div className="wq-chart-controls">
            {queues.length > 1 && (
              <label className="wq-select">
                <span>{t('wq.chart.queue')}</span>
                <select value={queue} onChange={(e) => setQueue(e.target.value)}>
                  <option value="">{t('wq.chart.allQueues')}</option>
                  {queues.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </header>
        <FailureGroups
          groups={data?.groups ?? null}
          now={now}
          detailed
          onOpen={(g) =>
            explore({
              status: 'failed',
              errorType: g.errorType,
              queue: queue || undefined,
            })
          }
        />
        {data && <p className="pf-chart-note">{t('jobs.failures.sampled', { count: data.sampled })}</p>}
      </section>
    </>
  );
};

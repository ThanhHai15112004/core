import React from 'react';
import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';
import type { JobProblem, JobRow, JobsOverview, JobsRange, JobsTab } from '../../types/jobs.types';
import { JobsKpis, type KpiKey } from '../../components/jobs/JobsKpis';
import { JobsProblems } from '../../components/jobs/JobsProblems';
import { FailureGroups } from '../../components/jobs/FailureGroups';
import { JobEventList } from '../../components/jobs/JobEventList';
import { JobSearchBox } from '../../components/jobs/JobSearchBox';
import { JobTable } from '../../components/jobs/JobTable';
import { WorkerChart } from '../../components/worker/WorkerChart';
import { STATUS_FILTERS } from '../../constants/jobs';
import { formatJobRate, formatMs, formatSignedRate } from '../../utils/worker-format';
import { useLocale } from '../../../../core/i18n/index';

type Explore = (f: Record<string, string | number | undefined>) => void;

const KPI_FILTER: Record<KpiKey, Record<string, string>> = {
  waiting: { status: 'waiting' },
  active: { status: 'active' },
  completedToday: { status: 'completed', window: '24h' },
  failedToday: { status: 'failed', window: '24h' },
  retrying: { status: 'retrying' },
  delayed: { status: 'delayed' },
  stalled: { status: 'stalled' },
  successRate: { status: 'completed', window: '24h' },
};

/**
 * Overview: KPI workload, Job Activity (throughput / chờ / thời gian / lỗi / retry), incoming vs completed, vấn đề hiện
 * tại, nhóm lỗi, job chạy lâu / treo, độ ưu tiên đang chờ, sự kiện gần đây. Tìm job ngay từ đây.
 */
export const JobsOverviewView: React.FC<{
  data: JobsOverview | null;
  range: JobsRange;
  paused: boolean;
  reloadKey: number;
  now: number;
  explore: Explore;
  openJob: (id: string, queue?: string | null) => void;
  openProblem: (p: JobProblem) => void;
  go: (tab: JobsTab) => void;
  navigate: (path: string) => void;
}> = ({ data, range, paused, now, explore, openJob, openProblem, go }) => {
  const { t } = useLocale();
  const rate = data?.rate;
  const Trend = rate?.state === 'draining' ? TrendingDown : TrendingUp;
  const openRow = (j: JobRow) => openJob(j.id, j.queue);
  const section = <T,>(s: { available: true; data: T } | { available: false; reason: string } | undefined, render: (d: T) => React.ReactNode) =>
    !s ? null : s.available ? render(s.data) : <p className="ov-empty-line">{t('jobs.unavailableSection', { reason: t(`jobs.reason.${s.reason}`) })}</p>;

  return (
    <>
      <div className="job-overview-search">
        <JobSearchBox value="" onSubmit={(q) => explore({ q: q || undefined })} />
        <nav className="job-status-row" aria-label={t('jobs.explorer.status')}>
          {STATUS_FILTERS.slice(0, 7).map((s) => (
            <button key={s} type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => explore({ status: s })}>
              {t(`jobs.statusTab.${s}`)}
            </button>
          ))}
        </nav>
      </div>

      <JobsKpis data={data} onOpen={(k) => explore(KPI_FILTER[k])} />

      <WorkerChart range={range} paused={paused} queues={data?.queues ?? []} title={t('jobs.chart.title')} />
      {rate && (
        <section className="ov-card ov-section job-rate">
          <dl className="db-stat-grid msg-balance">
            <div>
              <dt>{t('jobs.rate.completed')}</dt>
              <dd>{formatJobRate(rate.processingPerMin)}</dd>
            </div>
            <div>
              <dt>{t('jobs.rate.incoming')}</dt>
              <dd>{formatJobRate(rate.incomingPerMin)}</dd>
            </div>
            <div>
              <dt>{t('jobs.rate.diff')}</dt>
              <dd className={rate.state === 'growing' ? 'is-warn' : ''}>{formatSignedRate(rate.diffPerMin)}</dd>
            </div>
          </dl>
          {rate.state && (
            <p className={`msg-status-line ov-tone-${rate.state === 'growing' ? 'warn' : 'ok'}`}>
              {rate.state !== 'stable' && <Trend size={14} />} {t(`jobs.rate.state.${rate.state}`)}
            </p>
          )}
        </section>
      )}

      <JobsProblems data={data} onOpen={openProblem} />

      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('jobs.failures.groups')}</h3>
            <button type="button" className="ov-link" onClick={() => go('failures')}>
              {t('jobs.failures.viewAll')} <ArrowRight size={12} />
            </button>
          </header>
          <FailureGroups groups={data?.failureGroups ?? null} now={now} limit={6} onOpen={(g) => explore({ status: 'failed', errorType: g.errorType })} />
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('jobs.events.recent')}</h3>
            <button type="button" className="ov-link" onClick={() => go('events')}>
              {t('jobs.events.viewAll')} <ArrowRight size={12} />
            </button>
          </header>
          <JobEventList events={data?.events ?? null} onOpenJob={openJob} emptyText={t('jobs.events.none')} />
        </section>
      </div>

      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('jobs.longRunning.title')}</h3>
          </header>
          {section(data?.longRunning, (rows) => (
            <JobTable rows={rows} columns={['id', 'type', 'worker', 'running', 'progress']} now={now} onOpen={openRow} emptyText={t('jobs.longRunning.none')} />
          ))}
          <h4>{t('jobs.stalled.title')}</h4>
          <p className="ov-muted job-note">{t('jobs.stalled.hint')}</p>
          {section(data?.stalled, (rows) => (
            <JobTable rows={rows} columns={['id', 'type', 'worker', 'running', 'heartbeat']} now={now} onOpen={openRow} emptyText={t('jobs.stalled.none')} />
          ))}
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('jobs.priority.title')}</h3>
          </header>
          {section(data?.priorities, (rows) =>
            rows.length === 0 ? (
              <p className="ov-empty-line">{t('jobs.priority.none')}</p>
            ) : (
              <div className="scp-table-wrap">
                <table className="scp-table">
                  <thead>
                    <tr>
                      <th>{t('jobs.col.priority')}</th>
                      <th>{t('jobs.priority.waiting')}</th>
                      <th>{t('jobs.priority.oldest')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.level} className="is-clickable" onClick={() => explore({ status: 'waiting', priority: p.level })}>
                        <td>{t(`jobs.priority.${p.level}`)}</td>
                        <td>{p.waiting}</td>
                        <td className={(p.level === 'critical' || p.level === 'high') && (p.oldestSec ?? 0) >= 60 ? 'is-warn' : ''}>
                          {p.oldestSec === null ? '—' : formatMs(p.oldestSec * 1000)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ),
          )}
          <p className="ov-muted job-note">{t('jobs.priority.note')}</p>
        </section>
      </div>
    </>
  );
};

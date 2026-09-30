import React, { useCallback, useState } from 'react';
import { Pause, Play, Radio, RefreshCw, WifiOff } from 'lucide-react';
import type { JobProblem } from '../../types/jobs.types';
import { jobsApi } from '../../services/jobs.api';
import { usePolling } from '../../hooks/usePolling';
import { useJobsRoute } from '../../hooks/useJobsRoute';
import { useJobActions } from '../../hooks/useJobActions';
import { JOBS_RANGES, JOBS_STATUS_TONE, JOBS_TABS } from '../../constants/jobs';
import { JobsOverviewView } from './JobsOverviewView';
import { JobsExplorerView } from './JobsExplorerView';
import { JobsFailuresView } from './JobsFailuresView';
import { JobsPerformanceView } from './JobsPerformanceView';
import { JobsConfigView, JobsEventsView } from './JobsOtherViews';
import { JobDetailView } from './JobDetailView';
import { useLocale } from '../../../../core/i18n/index';
import { useNow } from '../../../../core/hooks/useNow';
import '../../styles/console-runtimes.css';
import '../../styles/console-traffic.css';
import '../../styles/console-performance.css';
import '../../styles/console-database.css';
import '../../styles/console-cache.css';
import '../../styles/console-messaging.css';
import '../../styles/console-worker.css';
import '../../styles/console-scheduler.css';
import '../../styles/console-jobs.css';

/**
 * Jobs: `jobs/<tab>` và `jobs/job/<id>/<sub>` — Job Explorer + Job Operations Center: job cụ thể nào có vấn đề, được tạo
 * từ đâu, chờ bao lâu, worker nào xử lý, chạy bao lâu, retry mấy lần, vì sao lỗi, retry / huỷ được không. Khác Worker &
 * Queue (queue nào nghẽn, worker nào quá tải) và Scheduler (khi nào kích hoạt). Provider không kết nối → nói rõ.
 */
export const JobsSection: React.FC = () => {
  const { t, formatRelative } = useLocale();
  const now = useNow();
  const route = useJobsRoute();
  const { tab, jobId, sub, detailQueue, range, filters, go, explore, openJob, setRange, navigate } = route;
  const [paused, setPaused] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const overview = usePolling(() => jobsApi.overview(range), `jobs:${range}:${reloadKey}`, undefined, paused);
  const bump = useCallback(() => setReloadKey((k) => k + 1), []);
  const data = overview.data;
  const actions = useJobActions(data?.settings, data?.environment ?? '', bump);

  const openProblem = (p: JobProblem) => {
    if (p.jobId && (p.code === 'LONG_RUNNING' || p.code === 'OLDEST_WAITING' || p.code === 'STALLED')) return openJob(p.jobId, p.queue);
    if (p.filter) return explore({ ...p.filter });
    go('explorer');
  };

  if (jobId) {
    return (
      <div className="ov-page">
        <JobDetailView
          key={`${jobId}:${reloadKey}`}
          id={jobId}
          queue={detailQueue}
          sub={sub}
          now={now}
          paused={paused}
          onSub={(s) => openJob(jobId, detailQueue, s)}
          onBack={() => (window.history.length > 1 ? window.history.back() : go('explorer'))}
          onAction={actions.request}
          openJob={openJob}
          navigate={navigate}
        />
        {actions.modal}
      </div>
    );
  }

  const renderTab = () => {
    const common = { range, paused, reloadKey, now };
    switch (tab) {
      case 'explorer':
        return (
          <JobsExplorerView
            {...common}
            filters={filters}
            queues={data?.queues ?? []}
            capabilities={data?.capabilities ?? []}
            settings={data?.settings ?? null}
            explore={explore}
            openJob={openJob}
            onBulkRetry={actions.bulk}
          />
        );
      case 'failures':
        return <JobsFailuresView {...common} queues={data?.queues ?? []} explore={explore} openJob={openJob} navigate={navigate} />;
      case 'performance':
        return <JobsPerformanceView {...common} explore={explore} />;
      case 'events':
        return <JobsEventsView {...common} openJob={openJob} />;
      case 'configuration':
        return <JobsConfigView />;
      default:
        return <JobsOverviewView {...common} data={data} explore={explore} openJob={openJob} openProblem={openProblem} go={go} navigate={navigate} />;
    }
  };

  const problems = data?.problems.length ?? 0;
  const tone = data ? JOBS_STATUS_TONE[data.status] : 'unknown';
  return (
    <div className="ov-page">
      <header className="ov-page-head">
        <div>
          <h1 className="ov-page-title">
            {t('nav.jobs')}
            {data && (
              <span className={`pf-chip ov-tone-${tone} job-page-status`}>
                <span className="ov-dot" aria-hidden="true" /> {t(`jobs.state.${data.status}`)}
              </span>
            )}
          </h1>
          <p className="ov-page-subtitle">
            {t('jobs.subtitle')}
            {data && ` · ${data.environment.toUpperCase()} · ${data.provider.product} (${data.provider.backend})`}
          </p>
        </div>
        <div className="tr-live">
          <span className={`tr-live-badge ${paused ? 'is-paused' : ''}`}>
            {paused ? <Pause size={12} /> : <Radio size={12} />}
            {paused ? t('tr.live.paused') : t('tr.live.live')}
          </span>
          <span className="ov-page-updated">
            <time>{overview.lastUpdated ? formatRelative(overview.lastUpdated, now) : '--'}</time>
          </span>
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={bump}>
            <RefreshCw size={13} /> {t('cache.refresh')}
          </button>
          <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => setPaused((p) => !p)} aria-pressed={paused}>
            {paused ? <Play size={13} /> : <Pause size={13} />} {paused ? t('tr.live.resume') : t('tr.live.pause')}
          </button>
        </div>
      </header>

      {overview.error && !data && (
        <section className="ov-offline" role="alert">
          <WifiOff size={22} className="ov-offline-icon" />
          <div className="ov-offline-body">
            <h2>{t('ov.offline.title')}</h2>
            <p>{overview.error.message}</p>
          </div>
        </section>
      )}
      {data?.status === 'unavailable' && (
        <section className="ov-offline" role="alert">
          <WifiOff size={22} className="ov-offline-icon" />
          <div className="ov-offline-body">
            <h2>{t('jobs.unavailable.title')}</h2>
            <p>
              {t('jobs.unavailable.message', {
                product: data.provider.product,
                state: data.provider.connection,
              })}
            </p>
          </div>
        </section>
      )}

      <div className="tr-controls">
        <nav className="rt-tabs" role="tablist" aria-label={t('nav.jobs')}>
          {JOBS_TABS.map((x) => (
            <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'is-active' : ''} onClick={() => go(x)}>
              {t(`jobs.tab.${x}`)}
              {x === 'overview' && problems > 0 && <span className="ov-count">{problems}</span>}
            </button>
          ))}
        </nav>
        {tab !== 'explorer' && tab !== 'configuration' && (
          <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.range')}>
            {JOBS_RANGES.map((r) => (
              <button key={r} type="button" role="tab" aria-selected={range === r} className={range === r ? 'is-active' : ''} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        )}
      </div>

      {renderTab()}
      {actions.modal}
    </div>
  );
};

import React, { useCallback, useState } from 'react';
import { Ban, Pause, Play, Radio, RefreshCw, WifiOff } from 'lucide-react';
import type { JobRow, WorkerAlert, WorkerEvent } from '../../types/worker.types';
import { workerApi } from '../../services/worker.api';
import { usePolling } from '../../hooks/usePolling';
import { useWorkerRoute } from '../../hooks/useWorkerRoute';
import { useQueueActions } from '../../hooks/useQueueActions';
import { TAB_CAPABILITY, WORKER_RANGES, WORKER_TABS } from '../../constants/worker';
import { WorkerHealthBanner } from '../../components/worker/WorkerHealthBanner';
import { WorkerDrawer } from '../../components/worker/WorkerDrawer';
import { WorkerOverviewView } from './WorkerOverviewView';
import { WorkerQueuesView, WorkerWorkersView } from './WorkerListViews';
import { QueueDetailView } from './QueueDetailView';
import { WorkerDelayedView, WorkerFailuresView } from './WorkerFailuresView';
import { WorkerConfigView, WorkerEventsView } from './WorkerOtherViews';
import { useLocale } from '../../../../core/i18n/index';
import { useNow } from '../../../../core/hooks/useNow';
import '../../styles/console-runtimes.css';
import '../../styles/console-traffic.css';
import '../../styles/console-performance.css';
import '../../styles/console-database.css';
import '../../styles/console-cache.css';
import '../../styles/console-storage.css';
import '../../styles/console-messaging.css';
import '../../styles/console-worker.css';

/**
 * Worker & Queue: `worker/<tab>/<id>/<sub>` — công việc nền có được worker thực thi kịp và thành công không:
 * worker online, backlog, incoming vs processing, thời gian chờ/xử lý, lỗi & retry, job treo, concurrency, sự kiện,
 * thao tác queue. Khác Messaging (message có đi từ producer tới consumer không) và Jobs (điều tra từng job).
 * Phần provider không hỗ trợ / không kết nối hiện rõ lý do — không có số liệu giả.
 */
export const WorkerSection: React.FC = () => {
  const { t, formatRelative } = useLocale();
  const now = useNow();
  const { tab, id, sub, range, query, go, openQueue, setRange, navigate } = useWorkerRoute();
  const [paused, setPaused] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const overview = usePolling(() => workerApi.overview(range), `worker:${range}:${reloadKey}`, undefined, paused);
  const bump = useCallback(() => setReloadKey((k) => k + 1), []);
  const data = overview.data;
  const actions = useQueueActions(data?.settings, bump);
  const caps = new Set(data?.capabilities ?? []);
  const product = data ? `${data.provider.product} (${data.provider.backend})` : '';
  const queueNames = data?.queues.available ? data.queues.data.map((q) => q.name) : [];

  /** Job cụ thể → Job Detail (vòng đời, lần thử, lỗi, nguồn, retry / huỷ). */
  const openJob = (j: Pick<JobRow, 'id' | 'queue'>) => navigate(`jobs/job/${encodeURIComponent(j.id)}?queue=${encodeURIComponent(j.queue)}`);
  const openAlert = (a: WorkerAlert) => (a.queue ? openQueue(a.queue, a.tab === 'failures' ? 'failures' : 'overview') : go(a.tab));
  const openEvent = (e: WorkerEvent) => (e.queue ? openQueue(e.queue) : e.tab ? go(e.tab) : undefined);

  const renderTab = () => {
    const cap = TAB_CAPABILITY[tab];
    if (data && cap && !caps.has(cap)) {
      return (
        <section className="tr-empty-state" role="status">
          <Ban size={28} />
          <h2>{t('wq.unsupported.title')}</h2>
          <p>{t('wq.unsupported.message', { product })}</p>
        </section>
      );
    }
    const common = { range, paused, reloadKey, product, now };
    switch (tab) {
      case 'workers':
        return <WorkerWorkersView {...common} openWorker={(w) => go('workers', w)} openQueue={openQueue} />;
      case 'queues':
        return id ? (
          <QueueDetailView
            key={id}
            {...common}
            name={id}
            sub={sub}
            onSub={(s) => openQueue(id, s, query)}
            onBack={() => go('queues')}
            onAction={actions.request}
            openJob={openJob}
            openWorker={(w) => go('workers', w)}
            navigate={navigate}
          />
        ) : (
          <WorkerQueuesView {...common} openQueue={openQueue} />
        );
      case 'failures':
        return <WorkerFailuresView {...common} queues={queueNames} openJob={openJob} openQueue={openQueue} openAlert={openAlert} onAction={actions.request} />;
      case 'delayed':
        return <WorkerDelayedView {...common} openJob={openJob} openQueue={openQueue} />;
      case 'events':
        return <WorkerEventsView {...common} openEvent={openEvent} />;
      case 'configuration':
        return <WorkerConfigView />;
      default:
        return <WorkerOverviewView data={data} {...common} go={go} openQueue={openQueue} openAlert={openAlert} openEvent={openEvent} openJob={openJob} />;
    }
  };

  const problems = data?.alerts.filter((a) => a.severity !== 'info').length ?? 0;
  const failing = data?.kpis.failed ?? 0;
  return (
    <div className="ov-page">
      <header className="ov-page-head">
        <div>
          <h1 className="ov-page-title">{t('nav.worker')}</h1>
          <p className="ov-page-subtitle">{t('wq.subtitle')}</p>
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

      {overview.error && !data ? (
        <section className="ov-offline" role="alert">
          <WifiOff size={22} className="ov-offline-icon" />
          <div className="ov-offline-body">
            <h2>{t('ov.offline.title')}</h2>
            <p>{overview.error.message}</p>
          </div>
        </section>
      ) : (
        data && (
          <WorkerHealthBanner
            data={data}
            now={now}
            onOpenQueue={(q) => openQueue(q)}
            onInspectWorkers={() => go('workers')}
            onInspectRuntime={() => navigate('runtimes/worker')}
          />
        )
      )}

      <div className="tr-controls">
        <nav className="rt-tabs" role="tablist" aria-label={t('nav.worker')}>
          {WORKER_TABS.map((x) => (
            <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'is-active' : ''} onClick={() => go(x)}>
              {t(`wq.tab.${x}`)}
              {x === 'overview' && problems > 0 && <span className="ov-count">{problems}</span>}
              {x === 'failures' && failing > 0 && <span className="ov-count">{failing}</span>}
            </button>
          ))}
        </nav>
        <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.range')}>
          {WORKER_RANGES.map((r) => (
            <button key={r} type="button" role="tab" aria-selected={range === r} className={range === r ? 'is-active' : ''} onClick={() => setRange(r)}>
              {r}
            </button>
          ))}
        </div>
      </div>

      {renderTab()}

      {id && tab === 'workers' && <WorkerDrawer key={id} id={id} onClose={() => go('workers')} onOpenQueue={(q) => openQueue(q)} navigate={navigate} />}
      {actions.modal}
    </div>
  );
};

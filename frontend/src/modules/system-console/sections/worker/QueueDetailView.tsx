import React, { useState } from 'react';
import { ArrowLeft, ExternalLink, Pause, Play, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { JobRow, JobState, QueueDetail, QueueDetailTab, WorkerRange } from '../../types/worker.types';
import type { QueueAction, QueueTarget } from '../../hooks/useQueueActions';
import { workerApi } from '../../services/worker.api';
import { usePolling } from '../../hooks/usePolling';
import { JOB_STATES, JOB_STATE_ICON, QUEUE_DETAIL_TABS, QUEUE_STATUS_TONE } from '../../constants/worker';
import { WorkerChart } from '../../components/worker/WorkerChart';
import { WorkerAlerts } from '../../components/worker/WorkerAlerts';
import { WorkerTable } from '../../components/worker/WorkerTable';
import { JobTable } from '../../components/worker/JobTable';
import { RateBalance } from '../../components/worker/RateBalance';
import { ConcurrencyPanel } from '../../components/worker/ConcurrencyPanel';
import { SectionState } from '../../components/database/SectionState';
import { WorkerFailuresView } from './WorkerFailuresView';
import { formatCompact } from '../../utils/database-format';
import { formatAge } from '../../utils/messaging-format';
import { formatJobRate, formatMs } from '../../utils/worker-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

interface Props {
  name: string;
  sub: QueueDetailTab;
  range: WorkerRange;
  paused: boolean;
  reloadKey: number;
  product: string;
  now: number;
  onSub: (sub: QueueDetailTab) => void;
  onBack: () => void;
  onAction: (action: QueueAction, target: QueueTarget) => void;
  openJob: (j: Pick<JobRow, 'id' | 'queue'>) => void;
  openWorker: (id: string) => void;
  navigate: (path: string) => void;
}

/**
 * Queue Detail: trạng thái + số job + incoming vs processing; tab Overview | Jobs | Workers | Failures | Metrics |
 * Configuration. Pause/Resume/Retry ở đầu trang; Drain nằm riêng trong Danger Zone (Configuration).
 */
export const QueueDetailView: React.FC<Props> = (props) => {
  const { name, sub, range, paused, reloadKey, product, now, onSub, onBack, onAction, openJob, openWorker, navigate } = props;
  const { t, locale } = useLocale();
  const { data, error } = usePolling(() => workerApi.queue(name, range), `queue:${name}:${range}:${reloadKey}`, 15_000, paused);
  const q = data?.queue;
  const n = (v: number) => formatCompact(v, locale);

  const body = () => {
    if (!data || !q) return null;
    switch (sub) {
      case 'jobs':
        return <QueueJobsPanel name={name} reloadKey={reloadKey} paused={paused} now={now} openJob={openJob} />;
      case 'workers':
        return (
          <>
            <section className="ov-card ov-section">
              <header className="ov-section-head">
                <h3>{t('wq.worker.title')}</h3>
              </header>
              <WorkerTable rows={data.workers} onOpen={openWorker} emptyText={t('wq.detail.noWorkers')} />
            </section>
            <div className="ov-split db-split-even">
              <section className="ov-card ov-section">
                <header className="ov-section-head">
                  <h3>{t('wq.concurrency.title')}</h3>
                </header>
                <ConcurrencyPanel concurrency={data.concurrency} workers={data.workers} />
              </section>
              <section className="ov-card ov-section">
                <header className="ov-section-head">
                  <h3>{t('wq.detail.connections')}</h3>
                  <span className="ov-section-hint">{product}</span>
                </header>
                {data.brokerWorkers === null ? (
                  <p className="ov-empty-line">{t('wq.detail.connectionsUnknown')}</p>
                ) : data.brokerWorkers.length === 0 ? (
                  <p className="ov-empty-line is-warn">{t('wq.detail.noConnections')}</p>
                ) : (
                  <ul className="cache-key-list">
                    {data.brokerWorkers.map((w, i) => (
                      <li key={`${w.addr}-${i}`}>
                        <span>
                          <code>{w.name ?? NO_VALUE}</code> · {w.addr ?? NO_VALUE}
                        </span>
                        <span>{t('wq.detail.connectionAge', { age: formatAge(w.ageSec), idle: formatAge(w.idleSec) })}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </>
        );
      case 'failures':
        return <WorkerFailuresView range={range} paused={paused} reloadKey={reloadKey} product={product} now={now} queue={name} openJob={openJob} onAction={onAction} />;
      case 'metrics':
        return (
          <>
            <WorkerChart range={range} paused={paused} queue={name} initial="throughput" />
            <WorkerChart range={range} paused={paused} queue={name} initial="waiting" title={t('wq.detail.depth')} />
            <WorkerChart range={range} paused={paused} queue={name} initial="duration" title={t('wq.detail.durationChart')} />
          </>
        );
      case 'configuration':
        return <QueueConfigPanel data={data} onAction={onAction} />;
      default:
        return (
          <>
            <div className="ov-split">
              <WorkerChart range={range} paused={paused} queue={name} initial="throughput" title={t('wq.detail.activity')} />
              <section className="ov-card ov-section">
                <header className="ov-section-head">
                  <h3>{t('wq.rates.title')}</h3>
                </header>
                <RateBalance
                  rates={data.rates}
                  wait={data.wait}
                  processing={data.processing}
                  onOpenOldest={data.wait.oldestJobId ? () => openJob({ id: data.wait.oldestJobId!, queue: name }) : undefined}
                />
              </section>
            </div>
            <div className="ov-split db-split-even">
              <section className="ov-card ov-section">
                <header className="ov-section-head">
                  <h3>{t('wq.capacity.title')}</h3>
                  <span className="ov-section-hint">{t('wq.capacity.hint')}</span>
                </header>
                <dl className="db-stat-grid db-stat-compact">
                  <div>
                    <dt>{t('wq.queue.waiting')}</dt>
                    <dd>{n(data.capacity.waiting)}</dd>
                  </div>
                  <div>
                    <dt>{t('wq.capacity.warn')}</dt>
                    <dd>{n(data.capacity.warn)}</dd>
                  </div>
                  <div>
                    <dt>{t('wq.capacity.crit')}</dt>
                    <dd>{n(data.capacity.crit)}</dd>
                  </div>
                </dl>
                <ul className="cache-bars">
                  <li className={data.capacity.percentOfWarn >= 100 ? 'is-warn' : ''}>
                    <span className="cache-bar-label">{t('wq.capacity.current')}</span>
                    <span className="cache-bar-track">
                      <span style={{ width: `${Math.min(100, data.capacity.percentOfWarn)}%` }} />
                    </span>
                    <span className="cache-bar-value">{data.capacity.percentOfWarn}%</span>
                  </li>
                </ul>
                <p className="pf-chart-note">{t('wq.capacity.note')}</p>
              </section>
              <WorkerAlerts alerts={data.alerts} now={now} onOpen={(a) => onSub(a.tab === 'failures' ? 'failures' : a.tab === 'workers' ? 'workers' : 'overview')} title={t('wq.alerts.queue')} />
            </div>
            <section className="ov-card ov-section">
              <header className="ov-section-head">
                <h3>{t('wq.detail.recentJobs')}</h3>
                <button type="button" className="ov-link" onClick={() => onSub('jobs')}>
                  {t('wq.detail.allJobs')} <Search size={12} />
                </button>
              </header>
              <SectionState section={data.recentJobs} driver={product} scope="wq">
                {(rows) => <JobTable rows={rows} columns={['id', 'type', 'state', 'attempt', 'duration', 'time']} onOpen={openJob} emptyText={t('wq.job.none')} now={now} />}
              </SectionState>
              <p className="pf-chart-note">{t('wq.job.openNote')}</p>
            </section>
            <section className="ov-card ov-section">
              <header className="ov-section-head">
                <h3>{t('wq.related.title')}</h3>
              </header>
              <div className="cache-drawer-actions">
                <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate(`jobs/explorer?queue=${encodeURIComponent(name)}`)}>
                  <ExternalLink size={13} /> {t('wq.related.jobs')}
                </button>
                <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate(`messaging/messages?queue=${encodeURIComponent(name)}`)}>
                  <ExternalLink size={13} /> {t('wq.related.messaging')}
                </button>
                <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate('runtimes/worker')}>
                  <ExternalLink size={13} /> {t('wq.related.runtime')}
                </button>
                <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => navigate('performance')}>
                  <ExternalLink size={13} /> {t('wq.related.performance')}
                </button>
              </div>
              <p className="pf-chart-note">{t('wq.related.note')}</p>
            </section>
          </>
        );
    }
  };

  return (
    <>
      <button type="button" className="ov-link wq-back" onClick={onBack}>
        <ArrowLeft size={13} /> {t('wq.detail.back')}
      </button>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {q && data && (
        <section className={`ov-card ov-section wq-detail-head ov-tone-${QUEUE_STATUS_TONE[q.status]}`}>
          <header className="ov-section-head">
            <div>
              <h2 className="wq-detail-title">
                <code>{q.name}</code>
              </h2>
              <p className={`msg-status-line ov-tone-${QUEUE_STATUS_TONE[q.status]}`}>
                <span className={`pf-chip ov-tone-${QUEUE_STATUS_TONE[q.status]}`}>{t(`wq.queue.statusOf.${q.status}`)}</span>
                <span>{t(`wq.queue.statusHint.${q.status}`)}</span>
              </p>
            </div>
            <div className="cache-drawer-actions">
              {data.settings.pause &&
                (q.paused ? (
                  <button type="button" className="scp-btn scp-btn-sm scp-btn-primary" onClick={() => onAction('resume', q)}>
                    <Play size={13} /> {t('wq.action.resume')}
                  </button>
                ) : (
                  <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => onAction('pause', q)}>
                    <Pause size={13} /> {t('wq.action.pause')}
                  </button>
                ))}
              {q.failed > 0 && (
                <>
                  <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => onSub('failures')}>
                    <Search size={13} /> {t('wq.action.viewFailed')}
                  </button>
                  {data.settings.retryFailed && (
                    <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => onAction('retry', q)}>
                      <RotateCcw size={13} /> {t('wq.action.retryFailed')}
                    </button>
                  )}
                </>
              )}
            </div>
          </header>
          {q.paused && <p className="msg-status-line ov-tone-warn">{t('wq.detail.pausedNote', { count: n(q.waiting) })}</p>}
          <dl className="db-stat-grid wq-detail-stats">
            <div>
              <dt>{t('wq.queue.waiting')}</dt>
              <dd className={q.status === 'backlog' || q.status === 'no_consumer' ? 'is-warn' : ''}>{n(q.waiting)}</dd>
            </div>
            <div>
              <dt>{t('wq.queue.active')}</dt>
              <dd>{n(q.active)}</dd>
            </div>
            <div>
              <dt>{t('wq.queue.delayed')}</dt>
              <dd>{n(q.delayed)}</dd>
            </div>
            <div>
              <dt>{t('wq.queue.failed')}</dt>
              <dd className={q.failed > 0 ? 'is-warn' : ''}>{n(q.failed)}</dd>
            </div>
            <div>
              <dt>{t('wq.rates.processing')}</dt>
              <dd>{formatJobRate(q.processingPerMin)}</dd>
            </div>
            <div>
              <dt>{t('wq.rates.incoming')}</dt>
              <dd>{formatJobRate(q.incomingPerMin)}</dd>
            </div>
            <div>
              <dt>{t('wq.wait.oldest')}</dt>
              <dd>{q.oldestWaitingSec === null ? NO_VALUE : formatMs(q.oldestWaitingSec * 1000)}</dd>
            </div>
            <div>
              <dt>P95</dt>
              <dd>{formatMs(q.p95Ms)}</dd>
            </div>
          </dl>
        </section>
      )}
      {data && (
        <nav className="rt-tabs wq-subtabs" role="tablist" aria-label={name}>
          {QUEUE_DETAIL_TABS.map((x) => (
            <button key={x} type="button" role="tab" aria-selected={sub === x} className={sub === x ? 'is-active' : ''} onClick={() => onSub(x)}>
              {t(`wq.detail.tab.${x}`)}
              {x === 'failures' && (q?.failed ?? 0) > 0 && <span className="ov-count">{q!.failed}</span>}
            </button>
          ))}
        </nav>
      )}
      {body()}
    </>
  );
};

/** Job của một queue theo trạng thái (tóm tắt; điều tra sâu → Messaging / Job Explorer sau này). */
const QueueJobsPanel: React.FC<{ name: string; reloadKey: number; paused: boolean; now: number; openJob: (j: JobRow) => void }> = ({
  name,
  reloadKey,
  paused,
  now,
  openJob,
}) => {
  const { t } = useLocale();
  const [states, setStates] = useState<JobState[]>(['active', 'waiting', 'failed']);
  const key = states.join(',');
  const { data, error } = usePolling(() => workerApi.jobs(name, states, 50), `jobs:${name}:${key}:${reloadKey}`, 15_000, paused);
  const toggle = (s: JobState) => setStates((cur) => (cur.includes(s) ? (cur.length > 1 ? cur.filter((x) => x !== s) : cur) : [...cur, s]));
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{t('wq.detail.jobs')}</h3>
        <div className="wq-state-filter" role="group" aria-label={t('wq.job.col.state')}>
          {JOB_STATES.map((s) => (
            <button key={s} type="button" aria-pressed={states.includes(s)} className={`pf-chip ${states.includes(s) ? 'is-active' : ''}`} onClick={() => toggle(s)}>
              {JOB_STATE_ICON[s]} {t(`wq.job.state.${s}`)}
            </button>
          ))}
        </div>
      </header>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      <SectionState section={data?.jobs} scope="wq">
        {(rows) => (
          <JobTable rows={rows} columns={['id', 'type', 'state', 'attempt', 'duration', 'worker', 'error', 'time']} onOpen={openJob} emptyText={t('wq.job.none')} now={now} />
        )}
      </SectionState>
      <p className="pf-chart-note">{t('wq.job.limitNote', { limit: data?.limit ?? 50 })}</p>
    </section>
  );
};

/** Cấu hình job của queue + ngưỡng + Danger Zone (Drain). */
const QueueConfigPanel: React.FC<{
  data: QueueDetail;
  onAction: (action: QueueAction, target: QueueTarget) => void;
}> = ({ data, onAction }) => {
  const { t, locale } = useLocale();
  const d = data.defaults;
  const q = data.queue;
  const rows: [string, React.ReactNode][] = [
    [t('wq.config.key.queue'), <code key="q">{q.name}</code>],
    [t('wq.config.key.concurrency'), q.concurrency || NO_VALUE],
    [t('wq.config.key.attempts'), d.attempts],
    [t('wq.config.key.backoff'), d.backoff ? t(`wq.config.value.backoff.${d.backoff.type}`) : t('wq.config.value.backoff.none')],
    [t('wq.config.key.backoffDelayMs'), d.backoff ? formatMs(d.backoff.delayMs) : NO_VALUE],
    [t('wq.config.key.removeOnComplete'), d.removeOnComplete ?? t('wq.config.value.keepAll')],
    [t('wq.config.key.removeOnFail'), d.removeOnFail ?? t('wq.config.value.keepAll')],
    [t('wq.config.key.backlogWarn'), formatCompact(data.capacity.warn, locale)],
    [t('wq.config.key.backlogCrit'), formatCompact(data.capacity.crit, locale)],
  ];
  return (
    <>
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('wq.detail.config')}</h3>
        </header>
        <div className="scp-table-wrap">
          <table className="scp-table tr-kv-table">
            <tbody>
              {rows.map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="ov-card ov-section wq-danger-zone">
        <header className="ov-section-head">
          <h3>{t('wq.danger.title')}</h3>
        </header>
        <p>{t('wq.danger.drainDescription')}</p>
        {data.settings.drain ? (
          <button type="button" className="scp-btn scp-btn-sm scp-btn-danger" onClick={() => onAction('drain', q)} disabled={q.waiting + q.delayed === 0}>
            <Trash2 size={13} /> {t('wq.action.drain')}
          </button>
        ) : (
          <p className="pf-chart-note">{t('wq.danger.disabled')}</p>
        )}
      </section>
    </>
  );
};

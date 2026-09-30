import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import type { JobRow, QueueDetailTab, WorkerAlert, WorkerRange } from '../../types/worker.types';
import type { QueueAction, QueueTarget } from '../../hooks/useQueueActions';
import { workerApi } from '../../services/worker.api';
import { usePolling } from '../../hooks/usePolling';
import { WorkerChart } from '../../components/worker/WorkerChart';
import { WorkerAlerts } from '../../components/worker/WorkerAlerts';
import { JobTable } from '../../components/worker/JobTable';
import { SectionState } from '../../components/database/SectionState';
import { formatCompact } from '../../utils/database-format';
import { formatMs, shortJobId } from '../../utils/worker-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

interface ViewProps {
  range: WorkerRange;
  paused: boolean;
  reloadKey: number;
  product: string;
  now: number;
  openJob: (j: Pick<JobRow, 'id' | 'queue'>) => void;
}

/**
 * Failures & Retry (toàn bộ hoặc một queue): số lỗi, tỷ lệ, đang retry, hồi phục, hết lượt thử; failure spike;
 * queue lỗi nhiều nhất; lý do lỗi gộp nhóm; biểu đồ; job đang chờ retry; job treo; job lỗi (dead letter).
 * Job treo không tự retry — side effect chưa rõ.
 */
export const WorkerFailuresView: React.FC<
  ViewProps & {
    queue?: string;
    queues?: string[];
    openQueue?: (name: string, sub?: QueueDetailTab) => void;
    openAlert?: (a: WorkerAlert) => void;
    onAction: (action: QueueAction, target: QueueTarget) => void;
  }
> = ({ range, paused, reloadKey, product, now, queue, queues = [], openJob, openQueue, openAlert, onAction }) => {
  const { t, locale, formatRelative } = useLocale();
  const { data, error } = usePolling(() => workerApi.failures(range, queue), `failures:${queue ?? ''}:${range}:${reloadKey}`, 15_000, paused);
  const n = (v: number | null) => (v === null ? NO_VALUE : formatCompact(v, locale));
  const s = data?.stats;
  const retryQueue = (name: string, failed: number) => onAction('retry', { name, failed, waiting: 0, active: 0, delayed: 0, paused: false });
  const kpis: { key: string; value: string; sub: string; warn: boolean }[] = s
    ? [
        { key: 'failed', value: n(s.failed), sub: t('wq.failures.todaySub', { count: n(s.failedToday) }), warn: s.failed > 0 },
        { key: 'rate', value: s.failureRatePercent === null ? NO_VALUE : `${s.failureRatePercent}%`, sub: t(`tr.range.${range}`), warn: (s.failureRatePercent ?? 0) > 0 },
        { key: 'retrying', value: n(s.retryingNow), sub: t('wq.failures.retriedSub', { count: n(s.retried) }), warn: (s.retryingNow ?? 0) > 0 },
        { key: 'recovered', value: n(s.recovered), sub: t('wq.failures.todaySub', { count: n(s.recoveredToday) }), warn: false },
        { key: 'exhausted', value: n(s.exhausted), sub: t('wq.failures.todaySub', { count: n(s.exhaustedToday) }), warn: s.exhausted > 0 },
        { key: 'deadLetter', value: n(s.deadLetter), sub: t('wq.failures.deadLetterSub'), warn: (s.deadLetter ?? 0) > 0 },
      ]
    : [];
  return (
    <>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {s && (
        <div className="ov-kpi-grid wq-kpi-6">
          {kpis.map((k) => (
            <div key={k.key} className={`ov-card ov-kpi ov-tone-${k.warn ? 'warn' : 'ok'}`}>
              <span className="ov-kpi-label">{t(`wq.failures.${k.key}`)}</span>
              <span className="ov-kpi-value">{k.value}</span>
              <span className="ov-kpi-sub">{k.sub}</span>
            </div>
          ))}
        </div>
      )}
      {data?.spike && (
        <section className="pf-status db-health ov-tone-warn" role="alert">
          <AlertTriangle size={20} className="pf-status-icon" />
          <div className="db-health-body">
            <strong>{t('wq.failures.spikeTitle')}</strong>
            <span>
              {t('wq.failures.spike', {
                from: data.spike.baselineRatePercent === null ? NO_VALUE : `${data.spike.baselineRatePercent}%`,
                to: `${data.spike.recentRatePercent}%`,
                min: data.spike.sinceMin,
              })}
              {!queue && data.byQueue[0] && ` · ${t('wq.failures.topQueue', { queue: data.byQueue[0].queue })}`}
            </span>
          </div>
        </section>
      )}
      {data && data.alerts.length > 0 && <WorkerAlerts alerts={data.alerts} now={now} onOpen={(a) => (openAlert ? openAlert(a) : undefined)} />}

      <div className="ov-split db-split-even">
        {!queue && (
          <section className="ov-card ov-section">
            <header className="ov-section-head">
              <h3>{t('wq.failures.byQueue')}</h3>
              <span className="ov-section-hint">{t(`tr.range.${range}`)}</span>
            </header>
            {data && data.byQueue.length === 0 ? (
              <p className="cache-ok-line">{t('wq.failures.noneByQueue')}</p>
            ) : (
              <ul className="cache-key-list">
                {data?.byQueue.map((b) => (
                  <li key={b.queue}>
                    <button type="button" className="ov-link" onClick={() => openQueue?.(b.queue, 'failures')}>
                      <code>{b.queue}</code>
                    </button>
                    <span>
                      {t('wq.failures.byQueueValue', { failures: n(b.failures), failed: n(b.failed) })}
                      {data.settings.retryFailed && b.failed > 0 && (
                        <button type="button" className="ov-link" onClick={() => retryQueue(b.queue, b.failed)}>
                          <RotateCcw size={12} /> {t('wq.action.retryFailed')}
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('wq.failures.reasons')}</h3>
            {data && <span className="ov-section-hint">{t('wq.failures.sampled', { count: data.sampled })}</span>}
          </header>
          {data && data.reasons.length === 0 ? (
            <p className="cache-ok-line">{t('wq.failures.noReasons')}</p>
          ) : (
            <div className="scp-table-wrap">
              <table className="scp-table">
                <thead>
                  <tr>
                    <th>{t('wq.failures.reason')}</th>
                    <th>{t('wq.failures.count')}</th>
                    <th>{t('wq.failures.queues')}</th>
                    <th>{t('wq.failures.last')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.reasons.map((r) => (
                    <tr key={r.reason}>
                      <td className="cache-key-cell">
                        <code>{r.reason}</code>
                      </td>
                      <td>{r.count}</td>
                      <td>{r.queues.join(', ')}</td>
                      <td>
                        {r.lastAt ? formatRelative(new Date(r.lastAt), now) : NO_VALUE}
                        {r.sampleJobId && (
                          <button type="button" className="ov-link" onClick={() => openJob({ id: r.sampleJobId!, queue: r.queues[0]! })}>
                            #{shortJobId(r.sampleJobId)}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <WorkerChart range={range} paused={paused} queues={queues} {...(queue ? { queue } : {})} initial="failures" title={t('wq.failures.trend')} />

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('wq.retry.title')}</h3>
          {s && <span className="ov-section-hint">{t('wq.retry.today', { retried: n(s.retriedToday), recovered: n(s.recoveredToday), exhausted: n(s.exhaustedToday) })}</span>}
        </header>
        <SectionState section={data?.retrying} driver={product} scope="wq">
          {(rows) => (
            <JobTable rows={rows} columns={['id', 'queue', 'type', 'attempt', 'runAt', 'error']} onOpen={openJob} emptyText={t('wq.retry.none')} now={now} />
          )}
        </SectionState>
      </section>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('wq.stalled.title')}</h3>
          <span className="ov-section-hint">{t('wq.stalled.hint')}</span>
        </header>
        <SectionState section={data?.stalled} driver={product} scope="wq">
          {(rows) => <JobTable rows={rows} columns={['id', 'queue', 'type', 'running', 'worker']} onOpen={openJob} emptyText={t('wq.stalled.none')} now={now} />}
        </SectionState>
        <p className="pf-chart-note">{t('wq.stalled.note')}</p>
      </section>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('wq.failed.title')}</h3>
          {queue && data?.settings.retryFailed && (s?.deadLetter ?? 0) > 0 && (
            <button type="button" className="scp-btn scp-btn-sm scp-btn-secondary" onClick={() => retryQueue(queue, s!.deadLetter!)}>
              <RotateCcw size={13} /> {t('wq.action.retryFailed')}
            </button>
          )}
        </header>
        <SectionState section={data?.failedJobs} driver={product} scope="wq">
          {(rows) => <JobTable rows={rows} columns={['id', 'queue', 'type', 'attempt', 'time', 'error']} onOpen={openJob} emptyText={t('wq.failed.none')} now={now} />}
        </SectionState>
        <p className="pf-chart-note">{t('wq.failed.note')}</p>
      </section>
    </>
  );
};

/** Job hẹn giờ: tổng, lần chạy kế tiếp, lâu nhất; theo lý do (retry / lặp / delay). Không phải cron của Scheduler. */
export const WorkerDelayedView: React.FC<ViewProps & { openQueue: (name: string, sub?: QueueDetailTab) => void }> = ({ paused, reloadKey, product, now, openJob }) => {
  const { t, locale, formatTime, formatRelative } = useLocale();
  const { data, error } = usePolling(() => workerApi.delayed(), `delayed:${reloadKey}`, 15_000, paused);
  const n = (v: number | null) => (v === null ? NO_VALUE : formatCompact(v, locale));
  return (
    <>
      {error && !data && <p className="scp-alert scp-alert-danger">{error.message}</p>}
      {data && (
        <div className="ov-kpi-grid wq-kpi-6">
          <div className="ov-card ov-kpi">
            <span className="ov-kpi-label">{t('wq.delayed.total')}</span>
            <span className="ov-kpi-value">{n(data.total)}</span>
          </div>
          <div className="ov-card ov-kpi">
            <span className="ov-kpi-label">{t('wq.delayed.nextDue')}</span>
            <span className="ov-kpi-value">{data.nextDueAt ? formatTime(Date.parse(data.nextDueAt)) : NO_VALUE}</span>
            <span className="ov-kpi-sub">{data.nextDueAt ? formatRelative(new Date(data.nextDueAt), now) : ''}</span>
          </div>
          <div className="ov-card ov-kpi">
            <span className="ov-kpi-label">{t('wq.delayed.oldest')}</span>
            <span className="ov-kpi-value">{data.oldestSec === null ? NO_VALUE : formatMs(data.oldestSec * 1000)}</span>
          </div>
          {(['retry', 'repeat', 'delay'] as const).map((r) => (
            <div key={r} className="ov-card ov-kpi">
              <span className="ov-kpi-label">{t(`wq.delayed.reason.${r}`)}</span>
              <span className="ov-kpi-value">{data.byReason[r]}</span>
            </div>
          ))}
        </div>
      )}
      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('wq.delayed.title')}</h3>
          <span className="ov-section-hint">{t('wq.delayed.hint')}</span>
        </header>
        <SectionState section={data?.jobs} driver={product} scope="wq">
          {(rows) => <JobTable rows={rows} columns={['id', 'queue', 'type', 'runAt', 'reason', 'attempt']} onOpen={openJob} emptyText={t('wq.delayed.none')} now={now} />}
        </SectionState>
        <p className="pf-chart-note">{t('wq.delayed.note')}</p>
      </section>
    </>
  );
};

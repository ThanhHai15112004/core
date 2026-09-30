import React from 'react';
import { ArrowRight } from 'lucide-react';
import type { JobRow, QueueDetailTab, WorkerAlert, WorkerEvent, WorkerOverview, WorkerReport, WorkerTab } from '../../types/worker.types';
import { WorkerKpis } from '../../components/worker/WorkerKpis';
import { WorkerChart } from '../../components/worker/WorkerChart';
import { WorkerAlerts } from '../../components/worker/WorkerAlerts';
import { WorkerEventList } from '../../components/worker/WorkerEventList';
import { QueueHealthCards } from '../../components/worker/QueueHealthCards';
import { QueueTable } from '../../components/worker/QueueTable';
import { WorkerTable } from '../../components/worker/WorkerTable';
import { RateBalance } from '../../components/worker/RateBalance';
import { ConcurrencyPanel } from '../../components/worker/ConcurrencyPanel';
import { SectionState } from '../../components/database/SectionState';
import { formatCompact } from '../../utils/database-format';
import { trendOf } from '../../utils/performance-format';
import { formatMs } from '../../utils/worker-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

interface Props {
  data: WorkerOverview | null;
  range: string;
  paused: boolean;
  now: number;
  go: (tab: WorkerTab, id?: string | null, query?: Record<string, string | number | undefined>) => void;
  openQueue: (name: string, sub?: QueueDetailTab) => void;
  openAlert: (a: WorkerAlert) => void;
  openEvent: (e: WorkerEvent) => void;
  openJob: (j: Pick<JobRow, 'id' | 'queue'>) => void;
}

const pct = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : ((a - b) / b) * 100);

/**
 * Operational dashboard: KPI → Queue Performance → incoming vs processing + vấn đề hiện tại → sức khoẻ từng queue →
 * bảng queue → worker instance + concurrency → lỗi & retry + phân bổ xử lý → báo cáo hôm nay/hôm qua → sự kiện.
 */
export const WorkerOverviewView: React.FC<Props> = ({ data, paused, now, go, openQueue, openAlert, openEvent, openJob }) => {
  const { t, locale } = useLocale();
  if (!data) return <WorkerKpis data={null} />;
  const n = (v: number | null) => (v === null ? NO_VALUE : formatCompact(v, locale));
  const queueNames = data.queues.available ? data.queues.data.map((q) => q.name) : [];
  const oldestQueue = data.queues.available
    ? data.queues.data.find((q) => q.oldestWaitingId === data.wait.oldestJobId && q.oldestWaitingId !== null)
    : undefined;
  const reportRow = (key: keyof WorkerReport, fmt: (v: number | null) => string, higherIsWorse: boolean | null) => {
    const today = data.report.today[key];
    const yesterday = data.report.yesterday[key];
    const trend = trendOf(pct(today, yesterday), higherIsWorse);
    return (
      <tr key={key}>
        <th>{t(`wq.report.${key}`)}</th>
        <td>{fmt(today)}</td>
        <td>{fmt(yesterday)}</td>
        <td>{trend ? <span className={`ov-kpi-trend is-${trend.tone}`}>{trend.text}</span> : NO_VALUE}</td>
      </tr>
    );
  };
  const f = data.failures;
  return (
    <>
      <WorkerKpis data={data} />
      <WorkerChart range={data.range} paused={paused} queues={queueNames} />

      <div className="ov-split">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('wq.rates.title')}</h3>
            <span className="ov-section-hint">{t(`tr.range.${data.range}`)}</span>
          </header>
          <RateBalance
            rates={data.rates}
            wait={data.wait}
            processing={data.processing}
            onOpenOldest={oldestQueue ? () => openJob({ id: data.wait.oldestJobId!, queue: oldestQueue.name }) : undefined}
          />
        </section>
        <WorkerAlerts alerts={data.alerts} data={data} now={now} onOpen={openAlert} title={t('wq.alerts.current')} />
      </div>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('wq.queue.health')}</h3>
          <span className="ov-section-hint">{data.provider.product}</span>
        </header>
        <SectionState section={data.queues} driver={data.provider.product} scope="wq">
          {(rows) => <QueueHealthCards rows={rows} onOpen={(q) => openQueue(q)} />}
        </SectionState>
      </section>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('wq.queue.title')}</h3>
          <button type="button" className="ov-link" onClick={() => go('queues')}>
            {t('wq.queue.viewAll')} <ArrowRight size={13} />
          </button>
        </header>
        <SectionState section={data.queues} driver={data.provider.product} scope="wq">
          {(rows) => <QueueTable rows={rows} sortable={false} onOpen={(q) => openQueue(q)} />}
        </SectionState>
      </section>

      <div className="ov-split">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('wq.worker.title')}</h3>
            <button type="button" className="ov-link" onClick={() => go('workers')}>
              {t('wq.worker.viewAll')} <ArrowRight size={13} />
            </button>
          </header>
          <WorkerTable rows={data.workers} onOpen={(w) => go('workers', w)} emptyText={t('wq.worker.empty')} />
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('wq.concurrency.title')}</h3>
          </header>
          <ConcurrencyPanel concurrency={data.concurrency} workers={data.workers} />
        </section>
      </div>

      <div className="ov-split db-split-even">
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('wq.failures.summary')}</h3>
            <button type="button" className="ov-link" onClick={() => go('failures')}>
              {t('wq.failures.open')} <ArrowRight size={13} />
            </button>
          </header>
          <dl className="db-stat-grid db-stat-compact">
            <div>
              <dt>{t('wq.failures.failed')}</dt>
              <dd className={f.failed > 0 ? 'is-warn' : ''}>{n(f.failed)}</dd>
            </div>
            <div>
              <dt>{t('wq.failures.rate')}</dt>
              <dd>{f.failureRatePercent === null ? NO_VALUE : `${f.failureRatePercent}%`}</dd>
            </div>
            <div>
              <dt>{t('wq.failures.retrying')}</dt>
              <dd>{n(data.kpis.retrying)}</dd>
            </div>
            <div>
              <dt>{t('wq.failures.recovered')}</dt>
              <dd>{n(f.recovered)}</dd>
            </div>
            <div>
              <dt>{t('wq.failures.exhausted')}</dt>
              <dd className={f.exhausted > 0 ? 'is-warn' : ''}>{n(f.exhausted)}</dd>
            </div>
            <div>
              <dt>{t('wq.failures.stalled')}</dt>
              <dd className={(f.stalled ?? 0) > 0 ? 'is-warn' : ''}>{n(f.stalled)}</dd>
            </div>
          </dl>
          <p className="pf-chart-note">{t('wq.failures.summaryNote', { range: t(`tr.range.${data.range}`) })}</p>
        </section>
        <section className="ov-card ov-section">
          <header className="ov-section-head">
            <h3>{t('wq.distribution.title')}</h3>
            <span className="ov-section-hint">{t(`tr.range.${data.range}`)}</span>
          </header>
          {data.distribution.length === 0 ? (
            <p className="ov-empty-line">{t('wq.distribution.empty')}</p>
          ) : (
            <ul className="cache-bars">
              {data.distribution.map((d) => (
                <li key={d.queue} className={d.percent >= 80 && data.distribution.length > 1 ? 'is-warn' : ''}>
                  <button type="button" className="ov-link cache-bar-label" onClick={() => openQueue(d.queue)}>
                    {d.queue}
                  </button>
                  <span className="cache-bar-track">
                    <span style={{ width: `${d.percent}%` }} />
                  </span>
                  <span className="cache-bar-value">{d.percent}%</span>
                </li>
              ))}
            </ul>
          )}
          <h4>{t('wq.stability.title')}</h4>
          <dl className="db-stat-grid db-stat-compact">
            <div>
              <dt>{t('wq.stability.restarts')}</dt>
              <dd className={data.stability.restartsToday > 0 ? 'is-warn' : ''}>{data.stability.restartsToday}</dd>
            </div>
            <div>
              <dt>{t('wq.stability.crashes')}</dt>
              <dd className={data.stability.crashesToday > 0 ? 'is-warn' : ''}>{data.stability.crashesToday}</dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('wq.report.title')}</h3>
          <span className="ov-section-hint">{t('db.report.hint')}</span>
        </header>
        <div className="scp-table-wrap">
          <table className="scp-table tr-kv-table db-report">
            <thead>
              <tr>
                <th />
                <th>{t('db.report.today')}</th>
                <th>{t('db.report.yesterday')}</th>
                <th>{t('db.report.change')}</th>
              </tr>
            </thead>
            <tbody>
              {reportRow('received', n, null)}
              {reportRow('completed', n, null)}
              {reportRow('failed', n, true)}
              {reportRow('retried', n, true)}
              {reportRow('successRatePercent', (v) => (v === null ? NO_VALUE : `${v}%`), false)}
              {reportRow('avgProcessingMs', formatMs, true)}
              {reportRow('p95ProcessingMs', formatMs, true)}
              {reportRow('peakBacklog', n, true)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ov-card ov-section">
        <header className="ov-section-head">
          <h3>{t('wq.events.title')}</h3>
          <button type="button" className="ov-link" onClick={() => go('events')}>
            {t('db.events.viewAll')} <ArrowRight size={13} />
          </button>
        </header>
        <WorkerEventList events={data.events} onOpen={openEvent} emptyText={t('wq.events.empty')} />
      </section>
    </>
  );
};

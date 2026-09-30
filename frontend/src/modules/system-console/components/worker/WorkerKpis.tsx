import React from 'react';
import type { WorkerOverview } from '../../types/worker.types';
import { formatCompact } from '../../utils/database-format';
import { formatJobRate, formatMs } from '../../utils/worker-format';
import type { StatusTone } from '../../utils/status-tone';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** 8 KPI đầu trang: worker, chờ, đang chạy, lỗi / throughput, thời gian xử lý, đang retry, hẹn giờ. */
export const WorkerKpis: React.FC<{ data: WorkerOverview | null }> = ({ data }) => {
  const { t, locale } = useLocale();
  if (!data) {
    return (
      <div className="ov-kpi-grid db-kpi-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="ov-card ov-kpi">
            <span className="ov-skeleton" style={{ width: '60%', height: 12 }} />
            <span className="ov-skeleton" style={{ width: '45%', height: 28, marginTop: 14 }} />
          </div>
        ))}
      </div>
    );
  }
  const k = data.kpis;
  const n = (v: number | null) => (v === null ? NO_VALUE : formatCompact(v, locale));
  const alert = (...rules: string[]): StatusTone | null => {
    const hits = data.alerts.filter((a) => rules.includes(a.rule));
    return hits.some((a) => a.severity === 'critical') ? 'crit' : hits.some((a) => a.severity === 'warning') ? 'warn' : null;
  };
  const range = t(`tr.range.${data.range}`);
  const items: { key: string; value: string; sub: string; tone: StatusTone }[] = [
    {
      key: 'workers',
      value: k.brokerWorkers === null ? String(k.workers) : `${k.workers} / ${k.brokerWorkers}`,
      sub: t('wq.kpi.workersSub'),
      tone: alert('NO_WORKER', 'WORKER_PRESSURE') ?? (k.workers === 0 && (k.waiting ?? 0) > 0 ? 'crit' : k.workers > 0 ? 'ok' : 'unknown'),
    },
    {
      key: 'waiting',
      value: n(k.waiting),
      sub: data.wait.oldestSec === null ? t('wq.kpi.waitingSubNone') : t('wq.kpi.waitingSub', { age: formatMs(data.wait.oldestSec * 1000) }),
      tone: alert('BACKLOG', 'OLDEST_WAITING', 'NO_WORKER', 'QUEUE_PAUSED') ?? (k.waiting === null ? 'unknown' : 'ok'),
    },
    {
      key: 'active',
      value: n(k.active),
      sub: data.concurrency ? t('wq.kpi.activeSub', { active: data.concurrency.active, configured: data.concurrency.configured }) : t('wq.kpi.activeSubNone'),
      tone: alert('CAPACITY', 'STALLED_JOBS') ?? 'unknown',
    },
    {
      key: 'failed',
      value: n(k.failed),
      sub: t('wq.kpi.failedSub', { count: n(k.failedInRange), range }),
      tone: alert('FAILURE_RATE', 'RETRY_STORM') ?? ((k.failed ?? 0) > 0 ? 'warn' : k.failed === null ? 'unknown' : 'ok'),
    },
    { key: 'throughput', value: formatJobRate(k.throughputPerMin), sub: t('wq.kpi.throughputSub', { range }), tone: 'unknown' },
    {
      key: 'duration',
      value: formatMs(k.avgDurationMs),
      sub: t('wq.kpi.durationSub', { p95: formatMs(data.processing.p95Ms) }),
      tone: alert('SLOW_PROCESSING') ?? 'unknown',
    },
    { key: 'retrying', value: n(k.retrying), sub: t('wq.kpi.retryingSub', { count: n(data.failures.retried), range }), tone: (k.retrying ?? 0) > 0 ? 'warn' : 'unknown' },
    { key: 'delayed', value: n(k.delayed), sub: t('wq.kpi.delayedSub'), tone: 'unknown' },
  ];
  return (
    <div className="ov-kpi-grid db-kpi-grid">
      {items.map((i) => (
        <div key={i.key} className={`ov-card ov-kpi ov-tone-${i.tone}`}>
          <span className="ov-kpi-label">{t(`wq.kpi.${i.key}`)}</span>
          <span className="ov-kpi-value">{i.value}</span>
          <span className="ov-kpi-sub">{i.sub}</span>
        </div>
      ))}
    </div>
  );
};

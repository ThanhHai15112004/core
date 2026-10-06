import React from 'react';
import type { JobsOverview } from '../../types/jobs.types';
import type { StatusTone } from '../../utils/status-tone';
import { formatCompact } from '../../utils/database-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

type KpiKey = 'waiting' | 'active' | 'completedToday' | 'failedToday' | 'retrying' | 'delayed' | 'stalled' | 'successRate';

/** Waiting · Active · Completed today · Failed · Retrying · Delayed · Stalled · Success rate — bấm → Explorer. */
export const JobsKpis: React.FC<{
  data: JobsOverview | null;
  onOpen: (key: KpiKey) => void;
}> = ({ data, onOpen }) => {
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
  const n = (v: number | null) => formatCompact(v, locale);
  const has = (code: string) => data.problems.find((p) => p.code === code);
  const tone = (code: string, fallback: StatusTone): StatusTone => {
    const p = has(code);
    return p ? (p.severity === 'critical' ? 'crit' : 'warn') : fallback;
  };
  const items: { key: KpiKey; value: string; sub: string; tone: StatusTone }[] = [
    {
      key: 'waiting',
      value: n(k.waiting),
      sub: t('jobs.kpi.waitingSub'),
      tone: tone('OLDEST_WAITING', has('NO_WORKER') ? 'crit' : 'unknown'),
    },
    {
      key: 'active',
      value: n(k.active),
      sub: t('jobs.kpi.activeSub'),
      tone: tone('LONG_RUNNING', 'ok'),
    },
    {
      key: 'completedToday',
      value: n(k.completedToday),
      sub: t('jobs.kpi.completedSub'),
      tone: 'ok',
    },
    {
      key: 'failedToday',
      value: n(k.failedToday),
      sub: t('jobs.kpi.failedSub', { count: n(k.failedNow) }),
      tone: tone('FAILURES', k.failedToday > 0 ? 'warn' : 'ok'),
    },
    {
      key: 'retrying',
      value: n(k.retrying),
      sub: t('jobs.kpi.retryingSub'),
      tone: tone('RETRY_STORM', (k.retrying ?? 0) > 0 ? 'warn' : 'unknown'),
    },
    {
      key: 'delayed',
      value: n(k.delayed),
      sub: t('jobs.kpi.delayedSub'),
      tone: 'unknown',
    },
    {
      key: 'stalled',
      value: n(k.stalled),
      sub: t('jobs.kpi.stalledSub'),
      tone: (k.stalled ?? 0) > 0 ? 'crit' : k.stalled === null ? 'unknown' : 'ok',
    },
    {
      key: 'successRate',
      value: k.successRatePercent === null ? NO_VALUE : `${k.successRatePercent}%`,
      sub: NO_VALUE,
      tone: k.successRatePercent === null ? 'unknown' : k.successRatePercent < 95 ? 'warn' : 'ok',
    },
  ];
  return (
    <div className="ov-kpi-grid db-kpi-grid">
      {items.map((i) => (
        <button key={i.key} type="button" className={`ov-card ov-kpi job-kpi ov-tone-${i.tone}`} onClick={() => onOpen(i.key)}>
          <span className="ov-kpi-label">{t(`jobs.kpi.${i.key}`)}</span>
          <span className="ov-kpi-value">{i.value}</span>
          <span className="ov-kpi-sub">{i.sub}</span>
        </button>
      ))}
    </div>
  );
};

export type { KpiKey };

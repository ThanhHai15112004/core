import React from 'react';
import type { SchedulerOverview } from '../../types/scheduler.types';
import type { StatusTone } from '../../utils/status-tone';
import { formatCompact } from '../../utils/database-format';
import { formatMs } from '../../utils/worker-format';
import { formatIn, secondsUntil } from '../../utils/scheduler-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** Registered · Enabled · Running · Failed today / Success rate · Avg duration · Missed runs · Next execution. */
export const SchedulerKpis: React.FC<{ data: SchedulerOverview | null; now: number }> = ({ data, now }) => {
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
  const n = (v: number) => formatCompact(v, locale);
  const alert = (...rules: string[]): StatusTone | null => {
    const hits = data.alerts.filter((a) => rules.includes(a.rule));
    return hits.some((a) => a.severity === 'critical') ? 'crit' : hits.length ? 'warn' : null;
  };
  const longRunning = data.running.filter((r) => r.longRunning).length;
  const nextTask = data.tasks.find((x) => x.id === k.nextExecutionTask);
  const range = t(`tr.range.${data.range}`);
  const items: { key: string; value: string; sub: string; tone: StatusTone }[] = [
    {
      key: 'registered',
      value: n(k.registered),
      sub: k.registered === 0 ? t('sch.kpi.registeredNone') : t('sch.kpi.registeredSub', { groups: new Set(data.tasks.map((x) => x.group)).size }),
      tone: alert('MISCONFIGURED') ?? (k.registered > 0 ? 'ok' : 'unknown'),
    },
    { key: 'enabled', value: `${n(k.enabled)} / ${n(k.registered)}`, sub: t('sch.kpi.enabledSub', { count: k.disabled }), tone: k.disabled > 0 ? 'unknown' : 'ok' },
    {
      key: 'running',
      value: n(k.running),
      sub: longRunning > 0 ? t('sch.kpi.runningLong', { count: longRunning }) : t('sch.kpi.runningSub'),
      tone: alert('LONG_RUNNING', 'OVERLAP') ?? 'unknown',
    },
    {
      key: 'failedToday',
      value: n(k.failedToday),
      sub: t('sch.kpi.failedSub', { count: n(k.executionsToday) }),
      tone: alert('CONSECUTIVE_FAILURES', 'RECENT_FAILURES') ?? (k.failedToday > 0 ? 'warn' : 'ok'),
    },
    {
      key: 'successRate',
      value: k.successRatePercent === null ? NO_VALUE : `${k.successRatePercent}%`,
      sub: t('sch.kpi.successSub'),
      tone: k.successRatePercent === null ? 'unknown' : k.successRatePercent < 95 ? 'warn' : 'ok',
    },
    { key: 'avgDuration', value: formatMs(k.avgDurationMs), sub: t('sch.kpi.durationSub', { p95: formatMs(k.p95DurationMs), range }), tone: 'unknown' },
    {
      key: 'missed',
      value: n(k.missedToday),
      sub: t('sch.kpi.missedSub', { count: n(k.skippedToday) }),
      tone: alert('MISSED_RUN', 'OVERDUE', 'HEARTBEAT_MISSING') ?? (k.missedToday > 0 ? 'warn' : 'ok'),
    },
    {
      key: 'next',
      value: k.nextExecutionAt ? formatIn(secondsUntil(k.nextExecutionAt, now)) : NO_VALUE,
      sub: nextTask ? nextTask.name : t('sch.kpi.nextNone'),
      tone: 'unknown',
    },
  ];
  return (
    <div className="ov-kpi-grid db-kpi-grid">
      {items.map((i) => (
        <div key={i.key} className={`ov-card ov-kpi ov-tone-${i.tone}`}>
          <span className="ov-kpi-label">{t(`sch.kpi.${i.key}`)}</span>
          <span className="ov-kpi-value">{i.value}</span>
          <span className="ov-kpi-sub">{i.sub}</span>
        </div>
      ))}
    </div>
  );
};

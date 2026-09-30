import React, { useState } from 'react';
import type { SchedulerMetric, SchedulerRange } from '../../types/scheduler.types';
import { schedulerApi } from '../../services/scheduler.api';
import { usePolling } from '../../hooks/usePolling';
import { SCHEDULER_METRICS } from '../../constants/scheduler';
import { LineChart } from '../common/LineChart';
import { toSchedulerChart } from '../../utils/scheduler-format';
import { formatUnit } from '../../utils/performance-format';
import { NO_VALUE } from '../../utils/runtime-format';
import { useLocale } from '../../../../core/i18n/index';

/** Scheduler Activity: lần chạy / thời lượng / lỗi / lỡ lịch theo thời gian — toàn bộ hoặc một task — kèm Current / Peak / Average. */
export const SchedulerChart: React.FC<{ range: SchedulerRange; paused: boolean; task?: string; initial?: SchedulerMetric; title?: string }> = ({
  range,
  paused,
  task,
  initial = 'executions',
  title,
}) => {
  const { t, formatTime } = useLocale();
  const [metric, setMetric] = useState<SchedulerMetric>(initial);
  const { data } = usePolling(() => schedulerApi.metrics(range, metric, task), `sch-metrics:${range}:${metric}:${task ?? ''}`, undefined, paused);
  const { series, unit } = toSchedulerChart(data?.series ?? []);
  const fmt = (v: number | null | undefined) => (v === null || v === undefined ? NO_VALUE : formatUnit(v, data?.unit ?? unit));
  return (
    <section className="ov-card ov-section">
      <header className="ov-section-head">
        <h3>{title ?? t('sch.chart.title')}</h3>
        <div className="ov-segmented" role="tablist" aria-label={t('ov.chart.metric')}>
          {SCHEDULER_METRICS.map((m) => (
            <button key={m} type="button" role="tab" aria-selected={metric === m} className={metric === m ? 'is-active' : ''} onClick={() => setMetric(m)}>
              {t(`sch.chart.metric.${m}`)}
            </button>
          ))}
        </div>
      </header>
      <dl className="db-stat-grid db-stat-compact sch-chart-stats">
        <div>
          <dt>{t('sch.chart.current')}</dt>
          <dd>{fmt(data?.stats.current)}</dd>
        </div>
        <div>
          <dt>{t('sch.chart.peak')}</dt>
          <dd>{fmt(data?.stats.peak)}</dd>
        </div>
        <div>
          <dt>{t('sch.chart.average')}</dt>
          <dd>{fmt(data?.stats.average)}</dd>
        </div>
      </dl>
      <LineChart
        series={series}
        unit={unit}
        formatTime={(ts) => formatTime(ts, range === '1h')}
        emptyText={t('sch.chart.empty')}
        ariaLabel={title ?? t('sch.chart.title')}
      />
      <p className="pf-chart-note">{t(`sch.chart.note.${metric}`)}</p>
    </section>
  );
};

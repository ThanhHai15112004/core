import { cn } from '@core/lib/cn';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { KeyValueGrid, Panel, type KeyValueItem } from '@core/ui/blocks';
import type { RuntimeDetail } from '../../types/runtime.types';
import { RuntimeMetricChart } from '../../components/runtimes/RuntimeMetricChart';

/** Metrics: tài nguyên Node.js hiện tại (tô vàng khi vượt ngưỡng) + biểu đồ theo thời gian kèm đường ngưỡng. */
export function RuntimeMetricsTab({ d }: { d: RuntimeDetail }) {
  const { t } = useLocale();
  const f = useFormat();
  const r = d.resources;
  const th = d.thresholds;
  const warn = (bad: boolean, text: string) => <span className={cn('font-mono tabular-nums', bad && 'text-warn-fg')}>{text}</span>;

  const items: KeyValueItem[] = r
    ? [
        { label: t('rt.metric.cpu'), value: warn(r.cpuPercent >= th.cpuPercent, f.percent(r.cpuPercent)), hint: t('rt.detail.thresholdHint', { value: f.percent(th.cpuPercent) }) },
        { label: t('rt.metric.rss'), value: warn(false, f.mb(r.rssMb)) },
        { label: t('rt.metric.memoryLimit'), value: warn(false, `${f.mb(r.memoryLimitMb)} · ${t(`rt.memorySource.${r.memoryLimitSource}`)}`) },
        {
          label: t('rt.metric.memoryPercent'),
          value: warn(r.memoryPercent !== null && r.memoryPercent >= th.memoryPercent, f.percent(r.memoryPercent)),
          hint: t('rt.detail.thresholdHint', { value: f.percent(th.memoryPercent) }),
        },
        { label: t('rt.metric.heap'), value: warn(false, `${f.mb(r.heapUsedMb)} / ${f.mb(r.heapTotalMb)}`) },
        { label: t('rt.metric.external'), value: warn(false, f.mb(r.externalMb)) },
        {
          label: t('rt.metric.eventLoop'),
          value: warn(
            (r.eventLoopP99Ms ?? 0) >= th.eventLoopMs,
            r.eventLoopMeanMs === null ? NO_VALUE : t('rt.metric.eventLoopValue', { mean: f.duration(r.eventLoopMeanMs), p99: f.duration(r.eventLoopP99Ms) }),
          ),
          hint: t('rt.detail.thresholdHint', { value: f.duration(th.eventLoopMs) }),
        },
        { label: t('rt.metric.gc'), value: warn(false, t('rt.metric.gcValue', { pause: f.duration(r.gcPauseMs), count: r.gcCount })), hint: t('rt.metric.gcHint') },
        { label: t('rt.metric.handles'), value: warn(false, f.number(r.activeHandles)) },
      ]
    : [];

  return (
    <>
      <RuntimeMetricChart runtime={d.id} names={{ [d.id]: d.name }} thresholds={th} height="lg" className="mb-4" />
      <Panel title={t('rt.detail.resources')}>
        {r ? <KeyValueGrid items={items} columns={3} /> : <p className="py-6 text-center text-sm text-muted">{t('rt.noTelemetry')}</p>}
      </Panel>
    </>
  );
}

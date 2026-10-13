import React from 'react';
import { useLocale } from '../../i18n/index';
import { ToggleGroup, ToggleGroupItem } from '../primitives/toggle-group';
import { Panel } from '../blocks/Panel';
import { PanelState } from '../blocks/PanelState';
import { TimeSeriesChart, type TimeSeries, type TimeSeriesChartProps } from './TimeSeriesChart';

export interface MetricOption<K extends string> {
  id: K;
  label: string;
}

export interface MetricStat {
  label: string;
  value: string;
}

export interface MetricChartProps<K extends string> extends Omit<TimeSeriesChartProps, 'series' | 'ariaLabel'> {
  title: React.ReactNode;
  hint?: React.ReactNode;
  /** Có từ 2 lựa chọn → hiện nút chuyển chỉ số. */
  metrics?: MetricOption<K>[];
  value?: K;
  onChange?: (metric: K) => void;
  /** `undefined` = đang tải (hoặc lỗi nếu có `error`). */
  series: TimeSeries[] | undefined;
  error?: unknown;
  onRetry?: () => void;
  /** Số tóm tắt nhỏ trên đầu biểu đồ (hiện tại / trung bình / đỉnh). */
  stats?: MetricStat[];
  /** Nút / chip thêm ở góc phải tiêu đề. */
  actions?: React.ReactNode;
  className?: string;
}

/** Panel biểu đồ theo thời gian kèm nút chọn chỉ số — dùng cho mọi trang có "biểu đồ chỉ số chính". */
export function MetricChart<K extends string>({
  title,
  hint,
  metrics,
  value,
  onChange,
  series,
  error,
  onRetry,
  stats,
  actions,
  className,
  ...chart
}: MetricChartProps<K>) {
  const { t } = useLocale();
  const current = metrics?.find((m) => m.id === value);
  return (
    <Panel
      title={title}
      hint={hint}
      expandable
      className={className}
      actions={
        <>
          {actions}
          {metrics && metrics.length > 1 && onChange && (
            <ToggleGroup type="single" value={value} onValueChange={(v) => v && onChange(v as K)} aria-label={t('ui.chart.metric')} className="max-w-full overflow-x-auto">
              {metrics.map((m) => (
                <ToggleGroupItem key={m.id} value={m.id}>
                  {m.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </>
      }
    >
      {stats && stats.length > 0 && (
        <dl className="mb-2 flex flex-wrap gap-x-5 gap-y-1">
          {stats.map((s) => (
            <div key={s.label} className="flex items-baseline gap-1.5">
              <dt className="text-xs text-muted">{s.label}</dt>
              <dd className="font-mono text-sm font-medium tabular-nums text-fg">{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {series === undefined ? (
        <PanelState status={error ? 'error' : 'loading'} error={error} onRetry={onRetry} skeleton="chart" />
      ) : (
        <TimeSeriesChart series={series} ariaLabel={current?.label ?? (typeof title === 'string' ? title : t('ui.chart.metric'))} {...chart} />
      )}
    </Panel>
  );
}

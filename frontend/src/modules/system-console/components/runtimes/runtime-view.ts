import { useCallback } from 'react';
import { useLocale } from '@core/i18n/index';
import { useFormat } from '@core/hooks/useFormat';
import { NO_VALUE } from '@core/lib/format';
import { toneOf, type Tone } from '@core/theme';
import type { ActivityItem } from '@core/ui/blocks';
import type { MetricValue, RuntimeEvent, RuntimeResources, RuntimeSummary } from '../../types/runtime.types';
import { RUNTIME_METRICS, type RuntimeMetricDef } from '../../constants/runtime-metrics';

/** Bộ nhớ "đang dùng" so với giới hạn: container → RSS, không có cgroup → heap V8. */
export const memoryUsedMb = (r: RuntimeResources): number => (r.memoryLimitSource === 'cgroup' ? r.rssMb : r.heapUsedMb);

export const metricDef = (runtime: RuntimeSummary, key: string): RuntimeMetricDef | undefined => RUNTIME_METRICS[runtime.id].find((m) => m.key === key);

/** Tông của một metric riêng: số > 0 ở metric "xấu" → đỏ. */
export function metricTone(def: RuntimeMetricDef, value: MetricValue | undefined): Tone | undefined {
  if (!def.bad || typeof value !== 'number') return undefined;
  return value > 0 ? 'crit' : undefined;
}

/** Định dạng metric riêng của runtime theo khai báo (đơn vị, thời điểm). Null → `—`. */
export function useMetricFormat() {
  const { formatRelative } = useLocale();
  const f = useFormat();
  return useCallback(
    (runtime: RuntimeSummary, key: string, def: RuntimeMetricDef | undefined = metricDef(runtime, key)): string => {
      const value = runtime.metrics[key];
      if (value === null || value === undefined || value === '') return NO_VALUE;
      if (def?.kind === 'time') return typeof value === 'string' ? formatRelative(value) : NO_VALUE;
      if (typeof value !== 'number') return String(value);
      switch (def?.unit) {
        case 'ms':
          return f.duration(value);
        case '%':
          return f.percent(value, 2);
        case 'perSec':
          return f.rate(value);
        case 'perMin':
          return f.rate(value, 'min');
        default:
          return f.number(value, 2);
      }
    },
    [f, formatRelative],
  );
}

/** Ngày + giờ theo locale hiện tại. */
export function useDateTime() {
  const { locale, formatTime } = useLocale();
  return useCallback((v: string | number) => `${new Date(v).toLocaleDateString(locale)} ${formatTime(v)}`, [locale, formatTime]);
}

/** Sự kiện vòng đời runtime → dòng ActivityFeed. */
export const eventToActivity = (e: RuntimeEvent, withSource: boolean): ActivityItem => ({
  id: e.id,
  at: e.at,
  tone: toneOf(e.level),
  title: e.message,
  kind: e.type,
  source: withSource ? e.runtimeName : null,
});

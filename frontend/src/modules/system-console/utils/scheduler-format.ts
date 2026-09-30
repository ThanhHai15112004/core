import type { ChartSeries } from '../components/common/LineChart';
import type { SchedulerSeries } from '../types/scheduler.types';
import { SCHEDULER_SERIES_COLORS } from '../constants/scheduler';
import { FALLBACK_COLORS } from '../constants/performance';
import { NO_VALUE } from './runtime-format';

/** Khoảng thời gian tới lần chạy kế tiếp: `42s`, `4m`, `2h 18m`, `6d`. */
export function formatIn(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return NO_VALUE;
  if (sec < 60) return `${Math.max(0, Math.round(sec))}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.floor(h / 24)}d${h % 24 ? ` ${h % 24}h` : ''}`;
}

/** Giây tới một thời điểm ISO (âm → 0). */
export const secondsUntil = (at: string | null | undefined, now: number) => (at ? Math.max(0, (Date.parse(at) - now) / 1000) : null);

/** Interval (ms) → `30s`, `5m`, `1h`. */
export function formatInterval(ms: number | null): string {
  if (!ms) return NO_VALUE;
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}

/** Execution id `sch_8f1a2b3c4d5e` → gọn cho bảng. */
export const shortExecId = (id: string) => (id.length > 14 ? `${id.slice(0, 10)}…` : id);

export function toSchedulerChart(list: SchedulerSeries[]): { series: ChartSeries[]; unit: string } {
  const first = list[0]?.unit ?? '';
  return {
    unit: first,
    series: list.map((s, i) => ({
      id: s.id,
      label: s.label,
      unit: s.unit,
      ...(s.unit !== first ? { axis: 'right' as const } : {}),
      color: SCHEDULER_SERIES_COLORS[s.id] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]!,
      points: s.points,
    })),
  };
}

import type { ChartSeries } from '../components/common/LineChart';
import type { WorkerSeries } from '../types/worker.types';
import { WORKER_SERIES_COLORS } from '../constants/worker';
import { FALLBACK_COLORS } from '../constants/performance';
import { formatUnit } from './performance-format';
import { NO_VALUE } from './runtime-format';

/** Tốc độ job theo phút: `124/min`, lớn thì theo giây (`42/s`). */
export function formatJobRate(perMin: number | null | undefined): string {
  if (perMin === null || perMin === undefined) return NO_VALUE;
  if (perMin >= 6000) return formatUnit(Number((perMin / 60).toFixed(0)), '/s');
  return formatUnit(Number(perMin.toFixed(perMin >= 100 ? 0 : 1)), '/min');
}

/** Có dấu: `+18/min`, `-40/min`. */
export const formatSignedRate = (perMin: number | null | undefined) =>
  perMin === null || perMin === undefined ? NO_VALUE : `${perMin > 0 ? '+' : ''}${formatJobRate(perMin)}`;

/** ms → `420 ms`, `2.8 s`, `4m 21s`. */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return NO_VALUE;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s >= 10 ? 0 : 1)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Job ID dài (UUID) → rút gọn để hiển thị trong bảng. */
export const shortJobId = (id: string) => (id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id);

/** Instance `worker@host:pid` → `host:pid` cho gọn. */
export const instanceLabel = (id: string) => (id.includes('@') ? id.slice(id.indexOf('@') + 1) : id);

export function toWorkerChart(list: WorkerSeries[]): { series: ChartSeries[]; unit: string } {
  const first = list[0]?.unit ?? '';
  return {
    unit: first,
    series: list.map((s, i) => ({
      id: s.id,
      label: s.label,
      unit: s.unit,
      ...(s.unit !== first ? { axis: 'right' as const } : {}),
      color: WORKER_SERIES_COLORS[s.id] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]!,
      points: s.points,
    })),
  };
}

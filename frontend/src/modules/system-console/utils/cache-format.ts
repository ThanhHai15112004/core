import { NO_VALUE } from './runtime-format';
import type { CacheSeries } from '../types/cache.types';
import type { ChartSeries } from '../components/common/LineChart';
import { CACHE_SERIES_COLORS } from '../constants/cache';
import { FALLBACK_COLORS } from '../constants/performance';

/** TTL còn lại: `42s`, `38m`, `6h 12m`, `6d 12h`; null → "không hết hạn" do caller hiển thị. */
export function formatTtl(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return NO_VALUE;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export const formatPercent = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? NO_VALUE : `${Number(v.toFixed(digits))}%`);

/** Tone của hit rate theo ngưỡng cảnh báo. */
export const hitRateTone = (v: number | null, warn: number) => (v === null ? 'unknown' : v < warn - 20 ? 'crit' : v < warn ? 'warn' : 'ok');

const MB = 1024 * 1024;

/** Series theo byte → MB để trục dễ đọc. */
export function toChartSeries(list: CacheSeries[]): { series: ChartSeries[]; unit: string } {
  const bytes = list[0]?.unit === 'B';
  return {
    unit: bytes ? 'MB' : (list[0]?.unit ?? ''),
    series: list.map((s, i) => ({
      id: s.id,
      label: s.label,
      unit: s.unit === 'B' ? 'MB' : s.unit,
      color: CACHE_SERIES_COLORS[s.id] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]!,
      points: s.unit === 'B' ? s.points.map((p) => ({ t: p.t, value: Number((p.value / MB).toFixed(2)) })) : s.points,
    })),
  };
}

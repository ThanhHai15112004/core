/** Cận trên (ms) của từng ô histogram latency; ô cuối cùng là "> 10s". */
export const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;
export const HISTOGRAM_SIZE = LATENCY_BUCKETS_MS.length + 1;

/** Các tầng lưu aggregate theo thời gian: độ phân giải và thời gian giữ. */
export const TELEMETRY_TIERS = {
  s10: { seconds: 10, ttlSec: 2 * 3600 },
  m1: { seconds: 60, ttlSec: 25 * 3600 },
  h1: { seconds: 3600, ttlSec: 8 * 24 * 3600 },
} as const;
export type TelemetryTier = keyof typeof TELEMETRY_TIERS;
export const TIER_ORDER: TelemetryTier[] = ['s10', 'm1', 'h1'];

/** Tầng mịn nhất còn giữ dữ liệu từ `fromMs`; `null` khi vượt quá thời gian lưu. */
export function tierCovering(fromMs: number, now: number): TelemetryTier | null {
  return TIER_ORDER.find((t) => now - fromMs <= TELEMETRY_TIERS[t].ttlSec * 1000) ?? null;
}

/**
 * Hậu tố field trong hash bucket `<metric>|<agg>`:
 * `c` tổng cộng dồn (counter), `n` số mẫu, `s` tổng giá trị, `x` lớn nhất, `h<i>` ô histogram.
 */
export type MetricAgg = 'c' | 'n' | 's' | 'x' | `h${number}`;
export const METRIC_FIELD_SEPARATOR = '|';

/** Số đo đã gộp của một metric trong một bucket (hoặc cả khoảng). */
export interface MetricValueAgg {
  c: number;
  n: number;
  s: number;
  /** `null` khi không có mẫu. */
  x: number | null;
  hist: number[] | null;
}

/** Slow query đã lưu — SQL đã chuẩn hoá, không có tham số. */
export interface SlowQueryRecord {
  /** epoch ms */
  at: number;
  sql: string;
  durationMs: number;
  failed: boolean;
  instance: string;
  correlationId: string | null;
}

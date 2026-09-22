import { HISTOGRAM_SIZE, LATENCY_BUCKETS_MS } from '../contracts/telemetry.types.js';

export type Histogram = number[];

export const emptyHistogram = (): Histogram => new Array<number>(HISTOGRAM_SIZE).fill(0);

/** Chỉ số ô chứa `durationMs` (ô cuối là "vượt cận trên lớn nhất"). */
export function histogramIndex(durationMs: number): number {
  const idx = LATENCY_BUCKETS_MS.findIndex((upper) => durationMs <= upper);
  return idx === -1 ? LATENCY_BUCKETS_MS.length : idx;
}

export function mergeHistogram(target: Histogram, source: readonly number[]): Histogram {
  for (let i = 0; i < HISTOGRAM_SIZE; i++) target[i] = (target[i] ?? 0) + (source[i] ?? 0);
  return target;
}

/**
 * Percentile xấp xỉ bằng nội suy tuyến tính trong ô chứa hạng cần tìm.
 * Ô cuối không có cận trên nên trả về cận dưới (10s) — UI hiển thị "≥".
 * `null` khi histogram rỗng.
 */
export function histogramPercentile(hist: readonly number[], p: number): number | null {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const rank = (p / 100) * total;
  let cumulative = 0;
  for (let i = 0; i < HISTOGRAM_SIZE; i++) {
    const count = hist[i] ?? 0;
    if (count === 0) continue;
    if (cumulative + count >= rank) {
      const lower = i === 0 ? 0 : LATENCY_BUCKETS_MS[i - 1]!;
      const upper = LATENCY_BUCKETS_MS[i];
      if (upper === undefined) return lower;
      const fraction = (rank - cumulative) / count;
      return Math.round((lower + (upper - lower) * fraction) * 10) / 10;
    }
    cumulative += count;
  }
  return LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1]!;
}

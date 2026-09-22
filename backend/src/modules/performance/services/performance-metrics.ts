import {
  emptyMetric,
  histogramPercentile,
  mergeMetric,
  type MetricBucket,
  type MetricValueAgg,
} from '@packages/telemetry/index.js';

/** Instance có dạng `<runtime>@<host>:<pid>`. */
export const runtimeOfInstance = (instance: string): string => instance.split('@')[0] ?? instance;

export const round = (n: number, digits = 2): number => Number(n.toFixed(digits));

const avgOf = (a: MetricValueAgg | undefined): number | null => (a && a.n > 0 ? a.s / a.n : null);

export interface GaugeOptions {
  runtime?: string | undefined;
  /** Chỉ một instance cụ thể (vd. process hiện tại của runtime). */
  instance?: string | undefined;
  /**
   * `sum`: cộng các instance (CPU, RSS của nhiều process).
   * `max`: lấy instance lớn nhất (số toàn cục mà mọi instance cùng báo, vd. độ sâu queue; hoặc % theo process).
   */
  mode?: 'sum' | 'max';
}

function instancesOf(bucket: MetricBucket, runtime: string | undefined, instance?: string) {
  return [...bucket.byInstance].filter(
    ([inst]) =>
      (!runtime || runtimeOfInstance(inst) === runtime) && (!instance || inst === instance),
  );
}

/** Instance mới nhất (có dữ liệu ở bucket muộn nhất) của một runtime. */
export function latestInstance(buckets: readonly MetricBucket[], runtime: string): string | null {
  for (let i = buckets.length - 1; i >= 0; i--) {
    const found = [...buckets[i]!.byInstance.keys()].filter(
      (inst) => runtimeOfInstance(inst) === runtime,
    );
    if (found.length) return found.sort().at(-1)!;
  }
  return null;
}

/** Giá trị gauge của một bucket (trung bình mẫu của từng instance, rồi gộp theo `mode`). */
export function gaugeOf(
  bucket: MetricBucket,
  metric: string,
  opts: GaugeOptions = {},
): number | null {
  const values = instancesOf(bucket, opts.runtime, opts.instance)
    .map(([, metrics]) => avgOf(metrics.get(metric)))
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return opts.mode === 'max' ? Math.max(...values) : values.reduce((a, b) => a + b, 0);
}

/** Đỉnh gauge trong bucket (giá trị lớn nhất từng instance ghi nhận). */
export function gaugePeakOf(
  bucket: MetricBucket,
  metric: string,
  opts: GaugeOptions = {},
): number | null {
  const values = instancesOf(bucket, opts.runtime, opts.instance)
    .map(([, metrics]) => metrics.get(metric)?.x ?? null)
    .filter((v): v is number => v !== null);
  if (values.length === 0) return null;
  return opts.mode === 'max' ? Math.max(...values) : values.reduce((a, b) => a + b, 0);
}

/** Tổng hợp một metric trên nhiều bucket (lọc runtime). */
export function mergedOf(
  buckets: readonly MetricBucket[],
  metric: string,
  runtime?: string,
): MetricValueAgg {
  const total = emptyMetric();
  for (const b of buckets) {
    if (!runtime) {
      const agg = b.metrics.get(metric);
      if (agg) mergeMetric(total, agg);
      continue;
    }
    for (const [, metrics] of instancesOf(b, runtime)) {
      const agg = metrics.get(metric);
      if (agg) mergeMetric(total, agg);
    }
  }
  return total;
}

export const percentileOf = (agg: MetricValueAgg, p: number): number | null =>
  agg.hist ? histogramPercentile(agg.hist, p) : null;

export const meanOf = (agg: MetricValueAgg): number | null => (agg.n > 0 ? agg.s / agg.n : null);

export interface GaugeWindow {
  /** Giá trị của bucket gần nhất có dữ liệu. */
  current: number | null;
  avg: number | null;
  peak: number | null;
  peakAt: number | null;
  points: { t: number; value: number }[];
}

/** Chuỗi và thống kê của một gauge trong cửa sổ. */
export function gaugeWindow(
  buckets: readonly MetricBucket[],
  metric: string,
  opts: GaugeOptions = {},
): GaugeWindow {
  const points: { t: number; value: number }[] = [];
  let peak: number | null = null;
  let peakAt: number | null = null;
  for (const b of buckets) {
    const value = gaugeOf(b, metric, opts);
    if (value === null) continue;
    points.push({ t: b.start, value });
    const high = gaugePeakOf(b, metric, opts) ?? value;
    if (peak === null || high > peak) {
      peak = high;
      peakAt = b.start;
    }
  }
  const avg = points.length ? points.reduce((a, p) => a + p.value, 0) / points.length : null;
  return { current: points.at(-1)?.value ?? null, avg, peak, peakAt, points };
}

/** Tổng counter trong cửa sổ (lọc runtime). */
export const counterOf = (
  buckets: readonly MetricBucket[],
  metric: string,
  runtime?: string,
): number => mergedOf(buckets, metric, runtime).c;

export interface Trend {
  /** Thay đổi theo đường hồi quy từ đầu tới cuối cửa sổ. */
  changeMb: number;
  /** Tỷ lệ bước tăng so với số bước. */
  increasingRatio: number;
  spanMin: number;
}

/** Hồi quy tuyến tính trên chuỗi (dùng để nhận biết bộ nhớ tăng liên tục). */
export function linearTrend(points: readonly { t: number; value: number }[]): Trend | null {
  if (points.length < 3) return null;
  const n = points.length;
  const t0 = points[0]!.t;
  const xs = points.map((p) => (p.t - t0) / 60_000);
  const ys = points.map((p) => p.value);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  const spanMin = xs[n - 1]!;
  let increasing = 0;
  for (let i = 1; i < n; i++) if (ys[i]! > ys[i - 1]!) increasing++;
  return { changeMb: slope * spanMin, increasingRatio: increasing / (n - 1), spanMin };
}

/** % thay đổi; `null` khi thiếu dữ liệu hoặc mốc bằng 0. */
export function changePercent(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return round(((current - previous) / previous) * 100, 1);
}

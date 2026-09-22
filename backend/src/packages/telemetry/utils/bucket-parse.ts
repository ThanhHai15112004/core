import {
  HISTOGRAM_SIZE,
  METRIC_FIELD_SEPARATOR,
  type MetricValueAgg,
} from '../contracts/telemetry.types.js';

export const emptyMetric = (): MetricValueAgg => ({ c: 0, n: 0, s: 0, x: null, hist: null });

/** Bucket số đo đã gộp mọi instance: metric → giá trị. */
export interface MetricBucket {
  /** epoch ms */
  start: number;
  metrics: Map<string, MetricValueAgg>;
  /** Số đo theo instance (để tách runtime/instance); key `instance`. */
  byInstance: Map<string, Map<string, MetricValueAgg>>;
}

function mergeField(agg: MetricValueAgg, kind: string, value: number): void {
  if (kind === 'c') agg.c += value;
  else if (kind === 'n') agg.n += value;
  else if (kind === 's') agg.s += value;
  else if (kind === 'x') agg.x = agg.x === null ? value : Math.max(agg.x, value);
  else if (kind.startsWith('h')) {
    const i = Number(kind.slice(1));
    if (!Number.isInteger(i) || i < 0 || i >= HISTOGRAM_SIZE) return;
    agg.hist ??= new Array<number>(HISTOGRAM_SIZE).fill(0);
    agg.hist[i] = (agg.hist[i] ?? 0) + value;
  }
}

/** Gộp hash `<metric>|<agg>` của một instance vào bucket. */
export function parseMetricHash(
  hash: Record<string, string>,
  instance: string,
  into: MetricBucket,
): void {
  let own = into.byInstance.get(instance);
  if (!own) {
    own = new Map();
    into.byInstance.set(instance, own);
  }
  for (const [f, raw] of Object.entries(hash)) {
    const value = Number(raw);
    const sep = f.lastIndexOf(METRIC_FIELD_SEPARATOR);
    if (!Number.isFinite(value) || sep <= 0) continue;
    const metric = f.slice(0, sep);
    const kind = f.slice(sep + 1);
    for (const target of [into.metrics, own]) {
      let agg = target.get(metric);
      if (!agg) {
        agg = emptyMetric();
        target.set(metric, agg);
      }
      mergeField(agg, kind, value);
    }
  }
}

export function mergeMetric(target: MetricValueAgg, source: MetricValueAgg): MetricValueAgg {
  target.c += source.c;
  target.n += source.n;
  target.s += source.s;
  if (source.x !== null) target.x = target.x === null ? source.x : Math.max(target.x, source.x);
  if (source.hist) {
    target.hist ??= new Array<number>(HISTOGRAM_SIZE).fill(0);
    source.hist.forEach((v, i) => (target.hist![i] = (target.hist![i] ?? 0) + v));
  }
  return target;
}

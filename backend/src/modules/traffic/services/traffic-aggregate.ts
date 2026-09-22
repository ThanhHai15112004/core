import {
  FIELD_SEPARATOR,
  PEAK_ACTIVE_FIELD,
  emptyHistogram,
  histogramPercentile,
  mergeHistogram,
  type Histogram,
} from '@packages/traffic/index.js';
import type {
  StatusClass,
  StatusClassDto,
  StatusCountDto,
  TrafficComparisonDto,
  TrafficStatsDto,
} from '../responses/traffic.response.js';

/** Aggregate của một endpoint (hoặc tổng) trong một khoảng thời gian. */
export interface EndpointAgg {
  n: number;
  ms: number;
  hist: Histogram;
  status: Map<number, number>;
  codes: Map<string, number>;
  /** Field `b.*` của breakdown theo giai đoạn (đơn vị 0.1 ms, riêng `b.n`/`b.dbq` là số đếm). */
  breakdown: Map<string, number>;
}

export interface BucketAgg {
  /** epoch ms */
  start: number;
  endpoints: Map<string, EndpointAgg>;
  peak: number;
}

export const emptyAgg = (): EndpointAgg => ({
  n: 0,
  ms: 0,
  hist: emptyHistogram(),
  status: new Map(),
  codes: new Map(),
  breakdown: new Map(),
});

const addTo = <K>(map: Map<K, number>, key: K, value: number) =>
  map.set(key, (map.get(key) ?? 0) + value);

/** Gộp hash `<routeId>|<metric>` của một instance vào bucket. */
export function parseBucketHash(hash: Record<string, string>, into: BucketAgg): void {
  for (const [field, raw] of Object.entries(hash)) {
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    if (field === PEAK_ACTIVE_FIELD) {
      // Peak của nhiều instance cộng lại là cận trên (các đỉnh có thể không trùng thời điểm).
      into.peak += value;
      continue;
    }
    const sep = field.indexOf(FIELD_SEPARATOR);
    if (sep <= 0) continue;
    const routeId = field.slice(0, sep);
    const metric = field.slice(sep + 1);
    let agg = into.endpoints.get(routeId);
    if (!agg) {
      agg = emptyAgg();
      into.endpoints.set(routeId, agg);
    }
    const kind = metric[0];
    const rest = metric.slice(1);
    if (metric === 'n') agg.n += value;
    else if (metric === 'ms') agg.ms += value;
    else if (kind === 'h') agg.hist[Number(rest)] = (agg.hist[Number(rest)] ?? 0) + value;
    else if (kind === 's') addTo(agg.status, Number(rest), value);
    else if (kind === 'x') addTo(agg.codes, rest, value);
    else if (metric.startsWith('b.')) addTo(agg.breakdown, metric, value);
  }
}

export function mergeAgg(target: EndpointAgg, source: EndpointAgg): EndpointAgg {
  target.n += source.n;
  target.ms += source.ms;
  mergeHistogram(target.hist, source.hist);
  for (const [k, v] of source.status) addTo(target.status, k, v);
  for (const [k, v] of source.codes) addTo(target.codes, k, v);
  for (const [k, v] of source.breakdown) addTo(target.breakdown, k, v);
  return target;
}

export type RouteFilter = (routeId: string) => boolean;

export function totalOf(buckets: readonly BucketAgg[], accept: RouteFilter): EndpointAgg {
  const total = emptyAgg();
  for (const b of buckets)
    for (const [id, agg] of b.endpoints) if (accept(id)) mergeAgg(total, agg);
  return total;
}

export function perEndpoint(
  buckets: readonly BucketAgg[],
  accept: RouteFilter,
): Map<string, EndpointAgg> {
  const map = new Map<string, EndpointAgg>();
  for (const b of buckets) {
    for (const [id, agg] of b.endpoints) {
      if (!accept(id)) continue;
      mergeAgg(map.get(id) ?? map.set(id, emptyAgg()).get(id)!, agg);
    }
  }
  return map;
}

export const classOf = (status: number): StatusClass | null =>
  status >= 200 && status < 600 ? (`${Math.floor(status / 100)}xx` as StatusClass) : null;

export function countWhere(agg: EndpointAgg, predicate: (status: number) => boolean): number {
  let sum = 0;
  for (const [s, c] of agg.status) if (predicate(s)) sum += c;
  return sum;
}

const round = (n: number, digits = 2) => Number(n.toFixed(digits));

export function statsOf(agg: EndpointAgg, seconds: number): TrafficStatsDto {
  const clientErrors = countWhere(agg, (s) => s >= 400 && s < 500);
  const serverErrors = countWhere(agg, (s) => s >= 500);
  const pct = (v: number) => (agg.n === 0 ? 0 : round((v / agg.n) * 100));
  return {
    requests: agg.n,
    requestsPerSecond: seconds > 0 ? round(agg.n / seconds, 3) : 0,
    avgLatencyMs: agg.n === 0 ? null : round(agg.ms / agg.n, 1),
    p50LatencyMs: histogramPercentile(agg.hist, 50),
    p95LatencyMs: histogramPercentile(agg.hist, 95),
    p99LatencyMs: histogramPercentile(agg.hist, 99),
    clientErrors,
    serverErrors,
    errorRatePercent: pct(serverErrors),
    clientErrorRatePercent: pct(clientErrors),
  };
}

export function statusClasses(agg: EndpointAgg): StatusClassDto[] {
  const classes: StatusClass[] = ['2xx', '3xx', '4xx', '5xx'];
  return classes.map((cls) => {
    const count = countWhere(agg, (s) => classOf(s) === cls);
    return { class: cls, count, percent: agg.n === 0 ? 0 : round((count / agg.n) * 100) };
  });
}

export function topStatuses(agg: EndpointAgg, limit = 10): StatusCountDto[] {
  return [...agg.status.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count || a.status - b.status)
    .slice(0, limit);
}

export function topCodes(agg: EndpointAgg, limit = 10): { code: string; count: number }[] {
  return [...agg.codes.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/** % thay đổi; `null` khi không có kỳ trước để so. */
export function percentDelta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return round(((current - previous) / previous) * 100, 1);
}

export function compare(
  current: TrafficStatsDto,
  previous: TrafficStatsDto | null,
): TrafficComparisonDto {
  if (!previous || previous.requests === 0) {
    return { requestsPercent: null, p95Percent: null, errorRateDelta: null };
  }
  return {
    requestsPercent: percentDelta(current.requests, previous.requests),
    p95Percent: percentDelta(current.p95LatencyMs, previous.p95LatencyMs),
    errorRateDelta: round(current.errorRatePercent - previous.errorRatePercent),
  };
}

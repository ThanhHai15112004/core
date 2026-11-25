import type { MetricObjectWithValues, MetricValue } from 'prom-client';
import { statusClassOf } from '@packages/metrics/index.js';
import type {
  HttpApiMetricItem,
  HttpStatusMetricItem,
  ModuleErrorMetricItem,
} from '../types/metrics-ops.types.js';

type PromMetric = MetricObjectWithValues<MetricValue<string>>;
type PromValueEntry = MetricValue<string> & { metricName?: string };

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Tính phân vị (giây -> ms) từ tập bucket cộng dồn của Prometheus histogram. */
export function quantileFromPromBuckets(
  buckets: ReadonlyMap<number, number>,
  totalCount: number,
  q: number,
): number | null {
  if (totalCount <= 0 || buckets.size === 0) return null;
  const target = totalCount * q;
  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  let prevBound = 0;
  let prevCount = 0;
  for (const [bound, count] of sorted) {
    if (!Number.isFinite(bound)) {
      return round2(prevBound * 1000);
    }
    if (count >= target) {
      const span = count - prevCount;
      if (span <= 0) return round2(bound * 1000);
      const ratio = (target - prevCount) / span;
      return round2((prevBound + (bound - prevBound) * ratio) * 1000);
    }
    prevBound = bound;
    prevCount = count;
  }
  return round2(prevBound * 1000);
}

interface BucketGroup {
  buckets: Map<number, number>;
  count: number;
}

function collectHistogramGroups(
  metric: PromMetric | undefined,
  keyFn: (labels: Partial<Record<string, string | number>>) => string,
): Map<string, BucketGroup> {
  const map = new Map<string, BucketGroup>();
  if (!metric) return map;

  for (const rawItem of metric.values) {
    const item = rawItem as PromValueEntry;
    const key = keyFn(item.labels);
    let grp = map.get(key);
    if (!grp) {
      grp = { buckets: new Map<number, number>(), count: 0 };
      map.set(key, grp);
    }
    if (item.metricName === `${metric.name}_bucket`) {
      const rawLe = item.labels['le'];
      const le = rawLe === '+Inf' ? Number.POSITIVE_INFINITY : Number(rawLe);
      if (!Number.isNaN(le)) {
        grp.buckets.set(le, (grp.buckets.get(le) ?? 0) + item.value);
      }
    } else if (item.metricName === `${metric.name}_count`) {
      grp.count += item.value;
    }
  }
  return map;
}

export interface LocalHttpMetricsSnapshot {
  totalRequests: number;
  errors4xx: number;
  errors5xx: number;
  errorRatePercent: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  byStatus: HttpStatusMetricItem[];
  byEndpoint: HttpApiMetricItem[];
  errorsByModule: ModuleErrorMetricItem[];
}

/**
 * Đọc trực tiếp snapshot metric HTTP từ `MetricsRegistryService.getMetricsJson()`
 * dùng làm fallback khi Prometheus chưa cấu hình hoặc tạm mất kết nối.
 */
export function buildLocalHttpSnapshot(
  metrics: readonly PromMetric[],
  defaultVersion: string,
  windowSeconds: number,
): LocalHttpMetricsSnapshot {
  const counterMetric = metrics.find((m) => m.name === 'http_requests_total');
  const histMetric = metrics.find((m) => m.name === 'http_request_duration_seconds');

  const statusTotals = new Map<number, number>();
  const endpointAcc = new Map<
    string,
    {
      method: string;
      route: string;
      module: string;
      requests: number;
      errors4xx: number;
      errors5xx: number;
    }
  >();
  const modVerAcc = new Map<
    string,
    {
      module: string;
      version: string;
      requests: number;
      errors4xx: number;
      errors5xx: number;
    }
  >();

  let totalRequests = 0;
  let errors4xx = 0;
  let errors5xx = 0;

  if (counterMetric) {
    for (const item of counterMetric.values) {
      const count = Math.round(item.value);
      if (count <= 0) continue;
      const method = String(item.labels['method'] ?? 'GET');
      const route = String(item.labels['route'] ?? '/');
      const mod = String(item.labels['module'] ?? 'root');
      const ver = String(item.labels['version'] ?? defaultVersion);
      const status = Number(item.labels['status'] ?? 0);

      totalRequests += count;
      if (status >= 400 && status < 500) errors4xx += count;
      if (status >= 500 && status < 600) errors5xx += count;
      if (status > 0) statusTotals.set(status, (statusTotals.get(status) ?? 0) + count);

      const epKey = `${method} ${route}`;
      let ep = endpointAcc.get(epKey);
      if (!ep) {
        ep = { method, route, module: mod, requests: 0, errors4xx: 0, errors5xx: 0 };
        endpointAcc.set(epKey, ep);
      }
      ep.requests += count;
      if (status >= 400 && status < 500) ep.errors4xx += count;
      if (status >= 500 && status < 600) ep.errors5xx += count;

      const mvKey = `${mod}::${ver}`;
      let mv = modVerAcc.get(mvKey);
      if (!mv) {
        mv = { module: mod, version: ver, requests: 0, errors4xx: 0, errors5xx: 0 };
        modVerAcc.set(mvKey, mv);
      }
      mv.requests += count;
      if (status >= 400 && status < 500) mv.errors4xx += count;
      if (status >= 500 && status < 600) mv.errors5xx += count;
    }
  }

  const allGroup = collectHistogramGroups(histMetric, () => 'all').get('all');
  const epGroups = collectHistogramGroups(
    histMetric,
    (l) => `${String(l['method'] ?? 'GET')} ${String(l['route'] ?? '/')}`,
  );
  const mvGroups = collectHistogramGroups(
    histMetric,
    (l) => `${String(l['module'] ?? 'root')}::${String(l['version'] ?? defaultVersion)}`,
  );

  const byStatus: HttpStatusMetricItem[] = [...statusTotals.entries()]
    .map(([status, count]) => ({
      status,
      statusClass: statusClassOf(status),
      count,
    }))
    .sort((a, b) => b.count - a.count || a.status - b.status);

  const byEndpoint: HttpApiMetricItem[] = [...endpointAcc.entries()]
    .map(([key, ep]) => {
      const grp = epGroups.get(key);
      return {
        method: ep.method,
        route: ep.route,
        module: ep.module,
        requests: ep.requests,
        rps: round2(ep.requests / Math.max(1, windowSeconds)),
        errors4xx: ep.errors4xx,
        errors5xx: ep.errors5xx,
        errorRatePercent: ep.requests > 0 ? round2((ep.errors5xx / ep.requests) * 100) : 0,
        p50Ms: grp ? quantileFromPromBuckets(grp.buckets, grp.count, 0.5) : null,
        p95Ms: grp ? quantileFromPromBuckets(grp.buckets, grp.count, 0.95) : null,
        p99Ms: grp ? quantileFromPromBuckets(grp.buckets, grp.count, 0.99) : null,
      };
    })
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 30);

  const errorsByModule: ModuleErrorMetricItem[] = [...modVerAcc.entries()]
    .map(([key, mv]) => {
      const grp = mvGroups.get(key);
      return {
        module: mv.module,
        version: mv.version,
        requests: mv.requests,
        errors4xx: mv.errors4xx,
        errors5xx: mv.errors5xx,
        errorRatePercent: mv.requests > 0 ? round2((mv.errors5xx / mv.requests) * 100) : 0,
        p50Ms: grp ? quantileFromPromBuckets(grp.buckets, grp.count, 0.5) : null,
        p95Ms: grp ? quantileFromPromBuckets(grp.buckets, grp.count, 0.95) : null,
        p99Ms: grp ? quantileFromPromBuckets(grp.buckets, grp.count, 0.99) : null,
      };
    })
    .sort((a, b) => b.errorRatePercent - a.errorRatePercent || b.requests - a.requests);

  return {
    totalRequests,
    errors4xx,
    errors5xx,
    errorRatePercent: totalRequests > 0 ? round2((errors5xx / totalRequests) * 100) : 0,
    p50Ms: allGroup ? quantileFromPromBuckets(allGroup.buckets, allGroup.count, 0.5) : null,
    p95Ms: allGroup ? quantileFromPromBuckets(allGroup.buckets, allGroup.count, 0.95) : null,
    p99Ms: allGroup ? quantileFromPromBuckets(allGroup.buckets, allGroup.count, 0.99) : null,
    byStatus,
    byEndpoint,
    errorsByModule,
  };
}

/** Tính p50/p95/p99 từ bất kỳ histogram nào trong `getMetricsJson()`, nhóm theo nhãn tùy chọn. */
export function readLocalHistogramQuantiles(
  metrics: readonly PromMetric[],
  metricName: string,
  groupByLabel?: string,
): Map<
  string,
  { count: number; sumMs: number; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null }
> {
  const hist = metrics.find((m) => m.name === metricName);
  const out = new Map<
    string,
    {
      count: number;
      sumMs: number;
      p50Ms: number | null;
      p95Ms: number | null;
      p99Ms: number | null;
    }
  >();
  if (!hist) return out;

  const groups = new Map<string, { buckets: Map<number, number>; count: number; sumSec: number }>();
  for (const rawItem of hist.values) {
    const item = rawItem as PromValueEntry;
    const key = groupByLabel ? String(item.labels[groupByLabel] ?? 'default') : 'all';
    let grp = groups.get(key);
    if (!grp) {
      grp = { buckets: new Map<number, number>(), count: 0, sumSec: 0 };
      groups.set(key, grp);
    }
    if (item.metricName === `${metricName}_bucket`) {
      const rawLe = item.labels['le'];
      const le = rawLe === '+Inf' ? Number.POSITIVE_INFINITY : Number(rawLe);
      if (!Number.isNaN(le)) grp.buckets.set(le, (grp.buckets.get(le) ?? 0) + item.value);
    } else if (item.metricName === `${metricName}_count`) {
      grp.count += item.value;
    } else if (item.metricName === `${metricName}_sum`) {
      grp.sumSec += item.value;
    }
  }

  for (const [key, grp] of groups.entries()) {
    out.set(key, {
      count: Math.round(grp.count),
      sumMs: round2(grp.sumSec * 1000),
      p50Ms: quantileFromPromBuckets(grp.buckets, grp.count, 0.5),
      p95Ms: quantileFromPromBuckets(grp.buckets, grp.count, 0.95),
      p99Ms: quantileFromPromBuckets(grp.buckets, grp.count, 0.99),
    });
  }
  return out;
}

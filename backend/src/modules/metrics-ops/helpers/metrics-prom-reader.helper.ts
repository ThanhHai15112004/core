import { statusClassOf, type PrometheusQueryClient, type PromSample } from '@packages/metrics/index.js';
import type {
  DbPoolMetricSummary,
  HttpApiMetricItem,
  HttpStatusMetricItem,
  InstanceResourceMetricItem,
  ModuleErrorMetricItem,
  ProviderLatencyMetricItem,
  QueueMetricItem,
  RedisDependencyLatencySummary,
} from '../types/metrics-ops.types.js';

const H_DUR = 'http_request_duration_seconds';
const H_REQ = 'http_requests_total';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toMs(sec: number | null | undefined): number | null {
  return sec === null || sec === undefined || !Number.isFinite(sec) ? null : round2(sec * 1000);
}

function mapSamples(
  samples: readonly PromSample[],
  keyFn: (labels: Record<string, string>) => string,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of samples) {
    m.set(keyFn(s.labels), s.value);
  }
  return m;
}

export interface PromHttpSummary {
  totalRequests: number;
  requestsPerSecond: number;
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

export async function queryPromHttpSummary(
  prom: PrometheusQueryClient,
  rangeMinutes: number,
  defaultVersion: string,
): Promise<PromHttpSummary | null> {
  const sec = Math.max(60, Math.round(rangeMinutes * 60));
  const w = `${sec}s`;

  const statusRows = await prom.query(`sum by (status) (increase(${H_REQ}[${w}]))`).catch(() => null);
  if (!statusRows) return null;

  const [
    p50,
    p95,
    p99,
    epReqs,
    epErr4,
    epErr5,
    epP50,
    epP95,
    epP99,
    mvReqs,
    mvErr4,
    mvErr5,
    mvP50,
    mvP95,
    mvP99,
  ] = await Promise.all([
    prom.value(`histogram_quantile(0.5, sum by (le) (rate(${H_DUR}_bucket[${w}])))`),
    prom.value(`histogram_quantile(0.95, sum by (le) (rate(${H_DUR}_bucket[${w}])))`),
    prom.value(`histogram_quantile(0.99, sum by (le) (rate(${H_DUR}_bucket[${w}])))`),
    prom.safeQuery(`sum by (method, route, module) (increase(${H_REQ}[${w}]))`),
    prom.safeQuery(`sum by (method, route, module) (increase(${H_REQ}{status_class="4xx"}[${w}]))`),
    prom.safeQuery(`sum by (method, route, module) (increase(${H_REQ}{status_class="5xx"}[${w}]))`),
    prom.safeQuery(`histogram_quantile(0.5, sum by (method, route, le) (rate(${H_DUR}_bucket[${w}])))`),
    prom.safeQuery(`histogram_quantile(0.95, sum by (method, route, le) (rate(${H_DUR}_bucket[${w}])))`),
    prom.safeQuery(`histogram_quantile(0.99, sum by (method, route, le) (rate(${H_DUR}_bucket[${w}])))`),
    prom.safeQuery(`sum by (module, version) (increase(${H_REQ}[${w}]))`),
    prom.safeQuery(`sum by (module, version) (increase(${H_REQ}{status_class="4xx"}[${w}]))`),
    prom.safeQuery(`sum by (module, version) (increase(${H_REQ}{status_class="5xx"}[${w}]))`),
    prom.safeQuery(`histogram_quantile(0.5, sum by (module, version, le) (rate(${H_DUR}_bucket[${w}])))`),
    prom.safeQuery(`histogram_quantile(0.95, sum by (module, version, le) (rate(${H_DUR}_bucket[${w}])))`),
    prom.safeQuery(`histogram_quantile(0.99, sum by (module, version, le) (rate(${H_DUR}_bucket[${w}])))`),
  ]);

  const byStatus: HttpStatusMetricItem[] = statusRows
    .map((s) => {
      const code = Number(s.labels['status']) || 0;
      return {
        status: code,
        statusClass: statusClassOf(code),
        count: Math.round(s.value),
      };
    })
    .filter((s) => s.status > 0 && s.count > 0)
    .sort((a, b) => b.count - a.count || a.status - b.status);

  const totalRequests = byStatus.reduce((sum, s) => sum + s.count, 0);
  const errors4xx = byStatus
    .filter((s) => s.statusClass === '4xx')
    .reduce((sum, s) => sum + s.count, 0);
  const errors5xx = byStatus
    .filter((s) => s.statusClass === '5xx')
    .reduce((sum, s) => sum + s.count, 0);

  const epKey = (l: Record<string, string>) => `${l['method'] ?? 'GET'} ${l['route'] ?? '/'}`;
  const mEpErr4 = mapSamples(epErr4, epKey);
  const mEpErr5 = mapSamples(epErr5, epKey);
  const mEpP50 = mapSamples(epP50, epKey);
  const mEpP95 = mapSamples(epP95, epKey);
  const mEpP99 = mapSamples(epP99, epKey);

  const byEndpoint: HttpApiMetricItem[] = epReqs
    .map((s) => {
      const key = epKey(s.labels);
      const reqs = Math.round(s.value);
      const e4 = Math.round(mEpErr4.get(key) ?? 0);
      const e5 = Math.round(mEpErr5.get(key) ?? 0);
      return {
        method: s.labels['method'] ?? 'GET',
        route: s.labels['route'] ?? '/',
        module: s.labels['module'] ?? 'root',
        requests: reqs,
        rps: round2(reqs / sec),
        errors4xx: e4,
        errors5xx: e5,
        errorRatePercent: reqs > 0 ? round2((e5 / reqs) * 100) : 0,
        p50Ms: toMs(mEpP50.get(key)),
        p95Ms: toMs(mEpP95.get(key)),
        p99Ms: toMs(mEpP99.get(key)),
      };
    })
    .filter((ep) => ep.requests > 0)
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 30);

  const mvKey = (l: Record<string, string>) =>
    `${l['module'] ?? 'root'}::${l['version'] ?? defaultVersion}`;
  const mMvErr4 = mapSamples(mvErr4, mvKey);
  const mMvErr5 = mapSamples(mvErr5, mvKey);
  const mMvP50 = mapSamples(mvP50, mvKey);
  const mMvP95 = mapSamples(mvP95, mvKey);
  const mMvP99 = mapSamples(mvP99, mvKey);

  const errorsByModule: ModuleErrorMetricItem[] = mvReqs
    .map((s) => {
      const key = mvKey(s.labels);
      const reqs = Math.round(s.value);
      const e4 = Math.round(mMvErr4.get(key) ?? 0);
      const e5 = Math.round(mMvErr5.get(key) ?? 0);
      return {
        module: s.labels['module'] ?? 'root',
        version: s.labels['version'] ?? defaultVersion,
        requests: reqs,
        errors4xx: e4,
        errors5xx: e5,
        errorRatePercent: reqs > 0 ? round2((e5 / reqs) * 100) : 0,
        p50Ms: toMs(mMvP50.get(key)),
        p95Ms: toMs(mMvP95.get(key)),
        p99Ms: toMs(mMvP99.get(key)),
      };
    })
    .filter((m) => m.requests > 0)
    .sort((a, b) => b.errorRatePercent - a.errorRatePercent || b.requests - a.requests);

  return {
    totalRequests,
    requestsPerSecond: round2(totalRequests / sec),
    errors4xx,
    errors5xx,
    errorRatePercent: totalRequests > 0 ? round2((errors5xx / totalRequests) * 100) : 0,
    p50Ms: toMs(p50),
    p95Ms: toMs(p95),
    p99Ms: toMs(p99),
    byStatus,
    byEndpoint,
    errorsByModule,
  };
}

export async function queryPromInstances(
  prom: PrometheusQueryClient,
  defaultVersion: string,
): Promise<InstanceResourceMetricItem[]> {
  const [cpuRows, rssRows, heapRows, elpRows] = await Promise.all([
    prom.safeQuery('sum by (runtime, instance, version) (rate(process_cpu_seconds_total[2m])) * 100'),
    prom.safeQuery('max by (runtime, instance, version) (process_resident_memory_bytes)'),
    prom.safeQuery('max by (runtime, instance, version) (nodejs_heap_size_used_bytes)'),
    prom.safeQuery('max by (runtime, instance, version) (nodejs_eventloop_lag_p99_seconds) * 1000'),
  ]);

  const instKey = (l: Record<string, string>) =>
    `${l['runtime'] ?? 'api'}::${l['instance'] ?? 'default'}`;
  const map = new Map<string, InstanceResourceMetricItem>();
  const ensure = (l: Record<string, string>) => {
    const key = instKey(l);
    let item = map.get(key);
    if (!item) {
      item = {
        runtime: l['runtime'] ?? 'api',
        instance: l['instance'] ?? 'default',
        version: l['version'] ?? defaultVersion,
        cpuPercent: null,
        memoryPercent: null,
        rssMb: null,
        heapUsedMb: null,
        eventLoopMeanMs: null,
        eventLoopP99Ms: null,
        uptimeSec: null,
        status: 'running',
      };
      map.set(key, item);
    }
    return item;
  };

  for (const s of cpuRows) {
    const cur = ensure(s.labels);
    map.set(instKey(s.labels), { ...cur, cpuPercent: round2(s.value) });
  }
  for (const s of rssRows) {
    const cur = ensure(s.labels);
    map.set(instKey(s.labels), { ...cur, rssMb: round2(s.value / (1024 * 1024)) });
  }
  for (const s of heapRows) {
    const cur = ensure(s.labels);
    map.set(instKey(s.labels), { ...cur, heapUsedMb: round2(s.value / (1024 * 1024)) });
  }
  for (const s of elpRows) {
    const cur = ensure(s.labels);
    map.set(instKey(s.labels), { ...cur, eventLoopP99Ms: round2(s.value) });
  }

  return [...map.values()];
}

export async function queryPromDbPool(
  prom: PrometheusQueryClient,
  fallbackState: string,
): Promise<DbPoolMetricSummary | null> {
  const [poolRows, sessions] = await Promise.all([
    prom.safeQuery('sum by (state) (core_db_pool_connections)'),
    prom.value('max(core_db_sessions)'),
  ]);
  if (poolRows.length === 0 && sessions === null) return null;
  const pick = (state: string) => {
    const found = poolRows.find((r) => r.labels['state'] === state);
    return found ? Math.round(found.value) : null;
  };
  const used = pick('used');
  const idle = pick('idle');
  const waiting = pick('waiting');
  const limit = pick('limit');
  const utilizationPercent =
    used !== null && limit !== null && limit > 0 ? round2((used / limit) * 100) : null;
  return {
    state: fallbackState,
    used,
    idle,
    waiting,
    limit,
    utilizationPercent,
    sessions: sessions === null ? null : Math.round(sessions),
  };
}

export async function queryPromQueues(
  prom: PrometheusQueryClient,
): Promise<QueueMetricItem[] | null> {
  const [stateRows, ageRows] = await Promise.all([
    prom.safeQuery('max by (queue, state) (core_queue_jobs)'),
    prom.safeQuery('max by (queue) (core_queue_oldest_job_age_seconds)'),
  ]);
  if (stateRows.length === 0 && ageRows.length === 0) return null;

  const map = new Map<
    string,
    { waiting: number; active: number; delayed: number; failed: number; oldestJobAgeSec: number | null }
  >();
  for (const row of stateRows) {
    const q = row.labels['queue'];
    const st = row.labels['state'];
    if (!q || !st) continue;
    let entry = map.get(q);
    if (!entry) {
      entry = { waiting: 0, active: 0, delayed: 0, failed: 0, oldestJobAgeSec: null };
      map.set(q, entry);
    }
    const v = Math.round(row.value);
    if (st === 'waiting') entry.waiting = v;
    else if (st === 'active') entry.active = v;
    else if (st === 'delayed') entry.delayed = v;
    else if (st === 'failed') entry.failed = v;
  }
  for (const row of ageRows) {
    const q = row.labels['queue'];
    if (!q) continue;
    let entry = map.get(q);
    if (!entry) {
      entry = { waiting: 0, active: 0, delayed: 0, failed: 0, oldestJobAgeSec: null };
      map.set(q, entry);
    }
    entry.oldestJobAgeSec = round2(row.value);
  }

  return [...map.entries()].map(([queue, item]) => ({
    queue,
    waiting: item.waiting,
    active: item.active,
    delayed: item.delayed,
    failed: item.failed,
    backlog: item.waiting + item.delayed,
    oldestJobAgeSec: item.oldestJobAgeSec,
    paused: false,
  }));
}

export async function queryPromRedisLatency(
  prom: PrometheusQueryClient,
  rangeMinutes: number,
): Promise<Pick<RedisDependencyLatencySummary, 'pingMs' | 'p50Ms' | 'p95Ms' | 'p99Ms'> | null> {
  const w = `${Math.max(60, Math.round(rangeMinutes * 60))}s`;
  const [pingSec, p50, p95, p99] = await Promise.all([
    prom.value('max(core_redis_ping_duration_seconds)'),
    prom.value(`histogram_quantile(0.5, sum by (le) (rate(core_redis_latency_seconds_bucket[${w}])))`),
    prom.value(`histogram_quantile(0.95, sum by (le) (rate(core_redis_latency_seconds_bucket[${w}])))`),
    prom.value(`histogram_quantile(0.99, sum by (le) (rate(core_redis_latency_seconds_bucket[${w}])))`),
  ]);
  if (pingSec === null && p50 === null && p95 === null && p99 === null) return null;
  return {
    pingMs: toMs(pingSec),
    p50Ms: toMs(p50),
    p95Ms: toMs(p95),
    p99Ms: toMs(p99),
  };
}

export async function queryPromProviders(
  prom: PrometheusQueryClient,
  rangeMinutes: number,
): Promise<ProviderLatencyMetricItem[]> {
  const w = `${Math.max(60, Math.round(rangeMinutes * 60))}s`;
  const [outReqs, outFails, outP50, outP95, outP99, regReqs, regFails, regP50, regP95, regP99] =
    await Promise.all([
      prom.safeQuery(`sum by (service) (increase(outbound_http_requests_total[${w}]))`),
      prom.safeQuery(
        `sum by (service) (increase(outbound_http_requests_total{outcome!="success"}[${w}]))`,
      ),
      prom.safeQuery(
        `histogram_quantile(0.5, sum by (service, le) (rate(outbound_http_request_duration_seconds_bucket[${w}])))`,
      ),
      prom.safeQuery(
        `histogram_quantile(0.95, sum by (service, le) (rate(outbound_http_request_duration_seconds_bucket[${w}])))`,
      ),
      prom.safeQuery(
        `histogram_quantile(0.99, sum by (service, le) (rate(outbound_http_request_duration_seconds_bucket[${w}])))`,
      ),
      prom.safeQuery(
        `sum by (provider_type, provider_code) (increase(provider_registry_invocations_total[${w}]))`,
      ),
      prom.safeQuery(
        `sum by (provider_type, provider_code) (increase(provider_registry_invocations_total{outcome!="success"}[${w}]))`,
      ),
      prom.safeQuery(
        `histogram_quantile(0.5, sum by (provider_type, provider_code, le) (rate(provider_registry_invocation_duration_seconds_bucket[${w}])))`,
      ),
      prom.safeQuery(
        `histogram_quantile(0.95, sum by (provider_type, provider_code, le) (rate(provider_registry_invocation_duration_seconds_bucket[${w}])))`,
      ),
      prom.safeQuery(
        `histogram_quantile(0.99, sum by (provider_type, provider_code, le) (rate(provider_registry_invocation_duration_seconds_bucket[${w}])))`,
      ),
    ]);

  const items: ProviderLatencyMetricItem[] = [];
  const svcFails = mapSamples(outFails, (l) => l['service'] ?? '');
  const svcP50 = mapSamples(outP50, (l) => l['service'] ?? '');
  const svcP95 = mapSamples(outP95, (l) => l['service'] ?? '');
  const svcP99 = mapSamples(outP99, (l) => l['service'] ?? '');

  for (const s of outReqs) {
    const name = s.labels['service'];
    if (!name) continue;
    const reqs = Math.round(s.value);
    const fails = Math.round(svcFails.get(name) ?? 0);
    items.push({
      provider: name,
      source: 'http-client',
      requests: reqs,
      failures: fails,
      errorRatePercent: reqs > 0 ? round2((fails / reqs) * 100) : 0,
      avgMs: null,
      p50Ms: toMs(svcP50.get(name)),
      p95Ms: toMs(svcP95.get(name)),
      p99Ms: toMs(svcP99.get(name)),
      circuitState: null,
    });
  }

  const pKey = (l: Record<string, string>) =>
    `${l['provider_type'] ?? 'provider'}:${l['provider_code'] ?? ''}`;
  const mRegFails = mapSamples(regFails, pKey);
  const mRegP50 = mapSamples(regP50, pKey);
  const mRegP95 = mapSamples(regP95, pKey);
  const mRegP99 = mapSamples(regP99, pKey);

  for (const s of regReqs) {
    const key = pKey(s.labels);
    const reqs = Math.round(s.value);
    const fails = Math.round(mRegFails.get(key) ?? 0);
    items.push({
      provider: key,
      source: 'provider-registry',
      requests: reqs,
      failures: fails,
      errorRatePercent: reqs > 0 ? round2((fails / reqs) * 100) : 0,
      avgMs: null,
      p50Ms: toMs(mRegP50.get(key)),
      p95Ms: toMs(mRegP95.get(key)),
      p99Ms: toMs(mRegP99.get(key)),
      circuitState: null,
    });
  }

  return items;
}

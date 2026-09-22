import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  TRAFFIC_TIERS,
  UNMATCHED_ROUTE,
  histogramPercentile,
  type RequestSummary,
  type TrafficRoute,
  type TrafficTier,
} from '@packages/traffic/index.js';
import { TrafficStoreService } from './traffic-store.service.js';
import {
  classOf,
  compare,
  countWhere,
  emptyAgg,
  mergeAgg,
  perEndpoint,
  statsOf,
  statusClasses,
  topCodes,
  topStatuses,
  totalOf,
  type BucketAgg,
  type EndpointAgg,
  type RouteFilter,
} from './traffic-aggregate.js';
import { evaluateEndpoint, isProblemStatus } from './traffic-status.js';
import {
  TrafficEndpointNotFoundException,
  TrafficRequestNotFoundException,
  TrafficTelemetryDisabledException,
  TrafficTelemetryUnavailableException,
} from '../exceptions/traffic.exceptions.js';
import type {
  ActiveRequestsDto,
  EndpointDetailDto,
  EndpointRowDto,
  ErrorAnalysisDto,
  RequestDetailDto,
  RequestListDto,
  SecurityTrafficDto,
  TimeseriesDto,
  TimeseriesMetric,
  TrafficInsightsDto,
  TrafficProblemDto,
  TrafficSettingsDto,
  TrafficStatsDto,
  TrafficSummary24hDto,
  TrafficSummaryDto,
} from '../responses/traffic.response.js';

export const TRAFFIC_RANGES = {
  '5m': 5,
  '15m': 15,
  '1h': 60,
  '6h': 360,
  '24h': 1440,
  '7d': 10080,
} as const;
export type TrafficRange = keyof typeof TRAFFIC_RANGES;

export const ENDPOINT_SORTS = ['traffic', 'latency', 'p95', 'errors'] as const;
export type EndpointSort = (typeof ENDPOINT_SORTS)[number];

/** Bộ lọc chung cho aggregate. */
export interface TrafficQuery {
  range: TrafficRange;
  instance?: string | undefined;
  method?: string | undefined;
  module?: string | undefined;
  routeId?: string | undefined;
  includeInternal: boolean;
}

export interface RequestQuery extends Omit<TrafficQuery, 'range'> {
  range?: TrafficRange | undefined;
  status?: string | undefined;
  search?: string | undefined;
  minMs?: number | undefined;
  /** `failed` = status ≥ 400, `slow` = ≥ ngưỡng chậm, `notable` = một trong hai. */
  kind?: 'failed' | 'slow' | 'notable' | undefined;
  offset: number;
  limit: number;
}

const MAX_POINTS = 120;
const MINUTE = 60_000;
/** Cửa sổ "hiện tại" và baseline để phát hiện spike. */
const SPIKE_WINDOW_MIN = 5;
const BASELINE_WINDOW_MIN = 60;
const ENDPOINT_PROBLEM_WINDOW_MIN = 15;
const SLOWEST_WINDOW_MIN = 10;
const TIER_ORDER: TrafficTier[] = ['s10', 'm1', 'h1'];

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Tầng mịn nhất còn giữ dữ liệu từ `fromMs`; `null` khi vượt quá thời gian lưu. */
export function tierCovering(fromMs: number, now: number): TrafficTier | null {
  return TIER_ORDER.find((t) => now - fromMs <= TRAFFIC_TIERS[t].ttlSec * 1000) ?? null;
}

interface Window {
  buckets: BucketAgg[];
  tier: TrafficTier;
  /** Số giây thực tế mà các bucket bao phủ (tới hiện tại). */
  seconds: number;
}

/**
 * Phân tích HTTP traffic từ aggregate đã ghi trong Redis. Không tự tạo số: không có dữ liệu → 0/null,
 * Redis không sẵn sàng → 503.
 */
@Injectable()
export class TrafficService {
  constructor(
    private readonly store: TrafficStoreService,
    private readonly config: CoreConfigService,
    private readonly i18n: CoreI18nService,
  ) {}

  private get cfg() {
    return this.config.traffic;
  }

  /** Ngưỡng request chậm mặc định (TRAFFIC_SLOW_MS). */
  public slowThresholdMs(): number {
    return this.cfg.slowMs;
  }

  public async getSummary(q: TrafficQuery): Promise<TrafficSummaryDto> {
    this.assertAvailable();
    const now = Date.now();
    const routes = await this.store.routes();
    const accept = this.routeFilter(q, routes);
    const len = TRAFFIC_RANGES[q.range] * MINUTE;

    const [current, previous, today, active, latest, allInstances] = await Promise.all([
      this.window(now - len, now, now, q.instance),
      this.window(now - 2 * len, now - len, now, q.instance),
      this.window(startOfToday(), now, now, q.instance),
      this.store.active(now),
      this.store.latestRequest(),
      this.store.instances(now - TRAFFIC_TIERS.h1.ttlSec * 1000),
    ]);

    const total = current ? totalOf(current.buckets, accept) : emptyAgg();
    const stats = statsOf(total, current?.seconds ?? 0);
    const prevStats = previous
      ? statsOf(totalOf(previous.buckets, accept), previous.seconds)
      : null;
    const activeCount = active
      .filter((s) => !q.instance || s.instance === q.instance)
      .flatMap((s) => s.active)
      .filter((a) => accept(a.routeId)).length;

    return {
      range: q.range,
      generatedAt: new Date(now).toISOString(),
      instances: allInstances.sort(),
      modules: [...new Set([...routes.values()].map((r) => r.module))].sort(),
      stats,
      comparison: compare(stats, prevStats),
      activeRequests: activeCount,
      peakActiveRequests: Math.max(activeCount, ...(current?.buckets.map((b) => b.peak) ?? [0])),
      requestsToday: today ? totalOf(today.buckets, accept).n : 0,
      hasTraffic: latest !== null,
      lastRequestAt: latest ? new Date(latest.at).toISOString() : null,
      statusClasses: statusClasses(total),
      topStatuses: topStatuses(total),
      settings: this.settings(),
    };
  }

  public async getTimeseries(q: TrafficQuery, metric: TimeseriesMetric): Promise<TimeseriesDto> {
    this.assertAvailable();
    const now = Date.now();
    const routes = await this.store.routes();
    const accept = this.routeFilter(q, routes);
    const win = await this.window(now - TRAFFIC_RANGES[q.range] * MINUTE, now, now, q.instance);
    const tierSec = win ? TRAFFIC_TIERS[win.tier].seconds : 0;
    const buckets = win?.buckets ?? [];
    const groupSize = Math.max(1, Math.ceil(buckets.length / MAX_POINTS));

    const groups: { t: number; agg: EndpointAgg; seconds: number }[] = [];
    for (let i = 0; i < buckets.length; i += groupSize) {
      const slice = buckets.slice(i, i + groupSize);
      const start = slice[0]!.start;
      const fullSec = slice.length * tierSec;
      // Nhóm cuối đang diễn ra: chia theo thời gian đã trôi qua, không phải cả bucket.
      const seconds = Math.max(1, Math.min(fullSec, (now - start) / 1000));
      groups.push({ t: start, agg: totalOf(slice, accept), seconds });
    }

    const rate = (n: number, s: number) => Number((n / s).toFixed(3));
    const pct = (v: number, n: number) => (n === 0 ? 0 : Number(((v / n) * 100).toFixed(2)));
    const series: TimeseriesDto['series'] = [];
    let unit: TimeseriesDto['unit'] = 'rps';
    const overall = mergeAll(groups.map((g) => g.agg));
    const overallStats = statsOf(
      overall,
      groups.reduce((a, g) => a + g.seconds, 0),
    );
    let average: number | null = null;

    if (metric === 'requests') {
      series.push({
        id: 'requests',
        points: groups.map((g) => ({ t: g.t, value: rate(g.agg.n, g.seconds) })),
      });
      average = overallStats.requestsPerSecond;
    } else if (metric === 'latency') {
      unit = 'ms';
      // P95 trước: series đầu tiên là series chính.
      for (const p of [95, 50, 99] as const) {
        series.push({
          id: `p${p}`,
          points: groups.flatMap((g) => {
            const v = histogramPercentile(g.agg.hist, p);
            return v === null ? [] : [{ t: g.t, value: v }];
          }),
        });
      }
      average = overallStats.p95LatencyMs;
    } else if (metric === 'errors') {
      unit = 'percent';
      const active = groups.filter((g) => g.agg.n > 0);
      series.push({
        id: '5xx',
        points: active.map((g) => ({
          t: g.t,
          value: pct(
            countWhere(g.agg, (s) => s >= 500),
            g.agg.n,
          ),
        })),
      });
      series.push({
        id: '4xx',
        points: active.map((g) => ({
          t: g.t,
          value: pct(
            countWhere(g.agg, (s) => s >= 400 && s < 500),
            g.agg.n,
          ),
        })),
      });
      average = overallStats.errorRatePercent;
    } else {
      for (const cls of ['2xx', '3xx', '4xx', '5xx'] as const) {
        series.push({
          id: cls,
          points: groups.map((g) => ({
            t: g.t,
            value: rate(
              countWhere(g.agg, (s) => classOf(s) === cls),
              g.seconds,
            ),
          })),
        });
      }
      average = overallStats.requestsPerSecond;
    }

    const primary =
      metric === 'status'
        ? groups.map((g) => ({ t: g.t, value: rate(g.agg.n, g.seconds) }))
        : (series[0]?.points ?? []);
    const peakPoint = primary.reduce<{ t: number; value: number } | null>(
      (best, p) => (!best || p.value > best.value ? p : best),
      null,
    );

    return {
      range: q.range,
      metric,
      stepSec: groupSize * tierSec,
      unit,
      series,
      current: primary.at(-1)?.value ?? null,
      average,
      peak: peakPoint?.value ?? null,
      peakAt: peakPoint?.t ?? null,
    };
  }

  public async getEndpoints(q: TrafficQuery, sort: EndpointSort): Promise<EndpointRowDto[]> {
    this.assertAvailable();
    const now = Date.now();
    const routes = await this.store.routes();
    const accept = this.routeFilter(q, routes);
    const win = await this.window(now - TRAFFIC_RANGES[q.range] * MINUTE, now, now, q.instance);
    const map = win ? perEndpoint(win.buckets, accept) : new Map<string, EndpointAgg>();
    for (const id of routes.keys()) if (accept(id) && !map.has(id)) map.set(id, emptyAgg());

    const rows = [...map.entries()].map(([id, agg]) =>
      this.row(routes.get(id) ?? unknownRoute(id), statsOf(agg, win?.seconds ?? 0)),
    );
    return rows.sort(ENDPOINT_COMPARATORS[sort]);
  }

  public async getEndpoint(routeId: string, q: TrafficQuery): Promise<EndpointDetailDto> {
    this.assertAvailable();
    const now = Date.now();
    const routes = await this.store.routes();
    const route = routes.get(routeId);
    if (!route) throw new TrafficEndpointNotFoundException(routeId);
    const scoped: TrafficQuery = { ...q, routeId, includeInternal: true };
    const accept = this.routeFilter(scoped, routes);
    const len = TRAFFIC_RANGES[q.range] * MINUTE;

    const [current, previous, today] = await Promise.all([
      this.window(now - len, now, now, q.instance),
      this.window(now - 2 * len, now - len, now, q.instance),
      this.window(startOfToday(), now, now, q.instance),
    ]);
    const agg = current ? totalOf(current.buckets, accept) : emptyAgg();
    const stats = statsOf(agg, current?.seconds ?? 0);
    const prevStats = previous
      ? statsOf(totalOf(previous.buckets, accept), previous.seconds)
      : null;

    return {
      ...this.row(route, stats),
      range: q.range,
      comparison: compare(stats, prevStats),
      requestsToday: today ? totalOf(today.buckets, accept).n : 0,
      topStatuses: topStatuses(agg),
      topErrorCodes: topCodes(agg),
    };
  }

  public async getRequests(q: RequestQuery): Promise<RequestListDto> {
    this.assertAvailable();
    const [log, routes] = await Promise.all([this.store.requestLog(), this.store.routes()]);
    const filtered = log.filter(this.requestFilter(q, routes));
    const items = filtered.slice(q.offset, q.offset + q.limit);
    const next = q.offset + items.length;
    return {
      items,
      total: filtered.length,
      nextOffset: next < filtered.length ? next : null,
      retained: this.cfg.requestLogSize,
    };
  }

  public async getRequest(requestId: string): Promise<RequestDetailDto> {
    this.assertAvailable();
    const [detail, routes] = await Promise.all([
      this.store.requestDetail(requestId),
      this.store.routes(),
    ]);
    const summary: RequestSummary | undefined =
      detail ?? (await this.store.requestLog()).find((r) => r.id === requestId);
    if (!summary) throw new TrafficRequestNotFoundException(requestId);
    return {
      summary: toSummary(summary),
      detail,
      route: routes.get(summary.routeId) ?? null,
    };
  }

  public async getErrors(q: TrafficQuery): Promise<ErrorAnalysisDto> {
    this.assertAvailable();
    const now = Date.now();
    const routes = await this.store.routes();
    const accept = this.routeFilter(q, routes);
    const win = await this.window(now - TRAFFIC_RANGES[q.range] * MINUTE, now, now, q.instance);
    const buckets = win?.buckets ?? [];
    const total = totalOf(buckets, accept);

    const topRoutes = [...perEndpoint(buckets, accept).entries()]
      .map(([id, agg]) => {
        const route = routes.get(id) ?? unknownRoute(id);
        return {
          routeId: id,
          method: route.method,
          route: route.route,
          clientErrors: countWhere(agg, (s) => s >= 400 && s < 500),
          serverErrors: countWhere(agg, (s) => s >= 500),
        };
      })
      .filter((r) => r.clientErrors + r.serverErrors > 0)
      .sort((a, b) => b.serverErrors - a.serverErrors || b.clientErrors - a.clientErrors)
      .slice(0, 10);

    return {
      range: q.range,
      stats: statsOf(total, win?.seconds ?? 0),
      topRoutes,
      topCodes: topCodes(total),
      topStatuses: topStatuses(total, 20).filter((s) => s.status >= 400),
    };
  }

  public async getActive(q: Omit<TrafficQuery, 'range'>): Promise<ActiveRequestsDto> {
    this.assertAvailable();
    const now = Date.now();
    const [snapshots, routes] = await Promise.all([this.store.active(now), this.store.routes()]);
    const accept = this.routeFilter({ ...q, range: '5m' }, routes);
    const items = snapshots
      .filter((s) => !q.instance || s.instance === q.instance)
      .flatMap((s) => s.active)
      .filter((a) => accept(a.routeId))
      .map((a) => {
        const runningMs = Math.max(0, now - a.startedAt);
        return { ...a, runningMs, longRunning: runningMs >= this.cfg.longRunningMs };
      })
      .sort((a, b) => b.runningMs - a.runningMs);
    return {
      generatedAt: new Date(now).toISOString(),
      longRunningMs: this.cfg.longRunningMs,
      items,
    };
  }

  public async getInsights(q: TrafficQuery): Promise<TrafficInsightsDto> {
    this.assertAvailable();
    const now = Date.now();
    const routes = await this.store.routes();
    const accept = this.routeFilter(q, routes);
    const len = TRAFFIC_RANGES[q.range] * MINUTE;

    const [recent, range, day] = await Promise.all([
      this.window(now - (SPIKE_WINDOW_MIN + BASELINE_WINDOW_MIN) * MINUTE, now, now, q.instance),
      this.window(now - len, now, now, q.instance),
      this.window(now - 24 * 60 * MINUTE, now, now, q.instance),
    ]);

    return {
      generatedAt: new Date(now).toISOString(),
      problems: recent ? this.detectProblems(recent.buckets, now, accept, routes) : [],
      security: this.securityTraffic(range?.buckets ?? [], accept, routes),
      rateLimit: { configured: false, message: this.i18n.t('traffic.rateLimit.notConfigured') },
      last24h: this.summarize24h(day?.buckets ?? [], accept),
    };
  }

  // ---------------------------------------------------------------------------

  private assertAvailable(): void {
    if (!this.cfg.enabled) throw new TrafficTelemetryDisabledException();
    if (!this.store.isAvailable()) throw new TrafficTelemetryUnavailableException();
  }

  private async window(
    fromMs: number,
    toMs: number,
    now: number,
    instance: string | undefined,
  ): Promise<Window | null> {
    const tier = tierCovering(fromMs, now);
    if (!tier) return null;
    const tierMs = TRAFFIC_TIERS[tier].seconds * 1000;
    const instances = instance ? [instance] : await this.store.instances(fromMs - tierMs);
    const buckets = await this.store.buckets(tier, fromMs, toMs, instances);
    const first = buckets[0]?.start ?? fromMs;
    return { buckets, tier, seconds: Math.max(1, (Math.min(toMs, now) - first) / 1000) };
  }

  private routeFilter(q: TrafficQuery, routes: Map<string, TrafficRoute>): RouteFilter {
    const method = q.method?.toUpperCase();
    return (id) => {
      if (q.routeId && id !== q.routeId) return false;
      const route = routes.get(id);
      if (!route) return !method && !q.module && q.includeInternal;
      if (!q.includeInternal && route.internal) return false;
      if (method && route.method !== method) return false;
      if (q.module && route.module !== q.module) return false;
      return true;
    };
  }

  private requestFilter(q: RequestQuery, routes: Map<string, TrafficRoute>) {
    const accept = this.routeFilter({ ...q, range: q.range ?? '7d' }, routes);
    const since = q.range ? Date.now() - TRAFFIC_RANGES[q.range] * MINUTE : 0;
    const search = q.search?.toLowerCase();
    const statusClass = /^[1-5]xx$/i.test(q.status ?? '') ? Number(q.status![0]) : null;
    const exactStatus = /^\d{3}$/.test(q.status ?? '') ? Number(q.status) : null;
    return (r: RequestSummary) =>
      accept(r.routeId) &&
      r.at >= since &&
      (!q.instance || r.instance === q.instance) &&
      (statusClass === null || Math.floor(r.status / 100) === statusClass) &&
      (exactStatus === null || r.status === exactStatus) &&
      (q.minMs === undefined || r.durationMs >= q.minMs) &&
      (!q.kind ||
        (q.kind === 'failed' && r.status >= 400) ||
        (q.kind === 'slow' && r.durationMs >= this.cfg.slowMs) ||
        (q.kind === 'notable' && (r.status >= 400 || r.durationMs >= this.cfg.slowMs))) &&
      (!search ||
        r.path.toLowerCase().includes(search) ||
        r.route.toLowerCase().includes(search) ||
        r.id.includes(search) ||
        (r.correlationId ?? '').toLowerCase().includes(search));
  }

  private row(route: TrafficRoute, stats: TrafficStatsDto): EndpointRowDto {
    const { status, reasons } = evaluateEndpoint(stats, this.cfg.thresholds);
    return {
      ...route,
      stats,
      status,
      reasons: reasons.map((r) => ({
        code: r.code,
        message: this.i18n.t(`traffic.reason.${r.code}`, r.params),
      })),
    };
  }

  private detectProblems(
    buckets: BucketAgg[],
    now: number,
    accept: RouteFilter,
    routes: Map<string, TrafficRoute>,
  ): TrafficProblemDto[] {
    const t = this.cfg.thresholds;
    const splitAt = now - SPIKE_WINDOW_MIN * MINUTE;
    const current = buckets.filter((b) => b.start >= splitAt);
    const baseline = buckets.filter((b) => b.start < splitAt);
    const curStats = statsOf(totalOf(current, accept), SPIKE_WINDOW_MIN * 60);
    const baseStats = statsOf(totalOf(baseline, accept), BASELINE_WINDOW_MIN * 60);
    const problems: TrafficProblemDto[] = [];
    const label = (id: string) => {
      const r = routes.get(id) ?? unknownRoute(id);
      return `${r.method} ${r.route}`;
    };
    const fmt = (n: number | null) =>
      n === null ? this.i18n.t('traffic.problem.none') : String(n);

    if (
      curStats.requestsPerSecond >= t.minRpsForAlert &&
      baseStats.requestsPerSecond > 0 &&
      ((curStats.requestsPerSecond - baseStats.requestsPerSecond) / baseStats.requestsPerSecond) *
        100 >=
        t.spikeIncreasePercent
    ) {
      const percent = Math.round(
        ((curStats.requestsPerSecond - baseStats.requestsPerSecond) / baseStats.requestsPerSecond) *
          100,
      );
      problems.push(
        this.problem('trafficSpike', 'warning', null, null, {
          percent,
          current: curStats.requestsPerSecond,
          baseline: baseStats.requestsPerSecond,
        }),
      );
    }

    const currentEndpoints = perEndpoint(current, accept);
    if (
      curStats.requests >= t.minRequestsForStatus &&
      curStats.errorRatePercent >= t.errorRateWarnPercent &&
      curStats.errorRatePercent > baseStats.errorRatePercent * 2
    ) {
      const top = [...currentEndpoints.entries()].sort(
        (a, b) => countWhere(b[1], (s) => s >= 500) - countWhere(a[1], (s) => s >= 500),
      )[0];
      problems.push(
        this.problem(
          'errorSpike',
          curStats.errorRatePercent >= t.errorRateCritPercent ? 'critical' : 'warning',
          top?.[0] ?? null,
          sinceOf(current, (agg) => countWhere(agg, (s) => s >= 500) > 0, accept),
          {
            baseline: baseStats.errorRatePercent,
            current: curStats.errorRatePercent,
            endpoint: top ? label(top[0]) : '—',
          },
        ),
      );
    }

    if (
      curStats.requests >= t.minRequestsForStatus &&
      curStats.p95LatencyMs !== null &&
      curStats.p95LatencyMs > t.endpointP95Ms &&
      (baseStats.p95LatencyMs === null || curStats.p95LatencyMs >= baseStats.p95LatencyMs * 2)
    ) {
      const affected = [...currentEndpoints.entries()]
        .map(([id, agg]) => ({ id, p95: histogramPercentile(agg.hist, 95) ?? 0 }))
        .filter((e) => e.p95 > t.endpointP95Ms)
        .sort((a, b) => b.p95 - a.p95)
        .slice(0, 3);
      problems.push(
        this.problem(
          'latency',
          'warning',
          affected[0]?.id ?? null,
          sinceOf(
            current,
            (agg) => (histogramPercentile(agg.hist, 95) ?? 0) > t.endpointP95Ms,
            accept,
          ),
          {
            baseline: fmt(baseStats.p95LatencyMs),
            current: curStats.p95LatencyMs,
            endpoints: affected.map((e) => label(e.id)).join(', ') || '—',
          },
        ),
      );
    }

    const endpointWindow = buckets.filter(
      (b) => b.start >= now - ENDPOINT_PROBLEM_WINDOW_MIN * MINUTE,
    );
    for (const [id, agg] of perEndpoint(endpointWindow, accept)) {
      const { status, reasons } = evaluateEndpoint(
        statsOf(agg, ENDPOINT_PROBLEM_WINDOW_MIN * 60),
        t,
      );
      if (!isProblemStatus(status)) continue;
      problems.push({
        kind: `endpoint.${status}`,
        severity: status === 'failing' ? 'critical' : 'warning',
        title: this.i18n.t(`traffic.problem.endpoint.${status}.title`, { endpoint: label(id) }),
        message: reasons.map((r) => this.i18n.t(`traffic.reason.${r.code}`, r.params)).join(' · '),
        routeId: id,
        since: null,
      });
    }
    return problems.sort((a, b) =>
      a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1,
    );
  }

  private problem(
    kind: 'trafficSpike' | 'errorSpike' | 'latency',
    severity: TrafficProblemDto['severity'],
    routeId: string | null,
    since: string | null,
    params: Record<string, string | number>,
  ): TrafficProblemDto {
    return {
      kind,
      severity,
      title: this.i18n.t(`traffic.problem.${kind}.title`),
      message: this.i18n.t(`traffic.problem.${kind}.message`, params),
      routeId,
      since,
    };
  }

  private securityTraffic(
    buckets: BucketAgg[],
    accept: RouteFilter,
    routes: Map<string, TrafficRoute>,
  ): SecurityTrafficDto[] {
    const endpoints = perEndpoint(buckets, accept);
    return ([401, 403, 429] as const).map((status) => {
      let count = 0;
      let top: SecurityTrafficDto['topRoute'] = null;
      for (const [id, agg] of endpoints) {
        const c = agg.status.get(status) ?? 0;
        count += c;
        if (c > 0 && (!top || c > top.count)) {
          const r = routes.get(id) ?? unknownRoute(id);
          top = { routeId: id, method: r.method, route: r.route, count: c };
        }
      }
      return { status, count, topRoute: top };
    });
  }

  private summarize24h(buckets: BucketAgg[], accept: RouteFilter): TrafficSummary24hDto {
    const total = totalOf(buckets, accept);
    let peak: TrafficSummary24hDto['peak'] = null;
    let peakN = 0;
    for (const b of buckets) {
      const n = totalOf([b], accept).n;
      if (n > peakN) {
        peakN = n;
        peak = {
          at: new Date(b.start).toISOString(),
          requestsPerSecond: Number((n / 60).toFixed(2)),
        };
      }
    }
    let slowest: TrafficSummary24hDto['slowest'] = null;
    for (let i = 0; i < buckets.length; i += SLOWEST_WINDOW_MIN) {
      const slice = buckets.slice(i, i + SLOWEST_WINDOW_MIN);
      const agg = totalOf(slice, accept);
      if (agg.n < this.cfg.thresholds.minRequestsForStatus) continue;
      const p95 = histogramPercentile(agg.hist, 95);
      if (p95 !== null && (!slowest || p95 > slowest.p95LatencyMs)) {
        slowest = {
          from: new Date(slice[0]!.start).toISOString(),
          to: new Date(slice.at(-1)!.start + MINUTE).toISOString(),
          p95LatencyMs: p95,
        };
      }
    }
    return {
      total: total.n,
      successful: countWhere(total, (s) => s < 400),
      clientErrors: countWhere(total, (s) => s >= 400 && s < 500),
      serverErrors: countWhere(total, (s) => s >= 500),
      peak,
      slowest,
    };
  }

  private settings(): TrafficSettingsDto {
    const c = this.cfg;
    return {
      slowMs: c.slowMs,
      longRunningMs: c.longRunningMs,
      endpointP95WarnMs: c.thresholds.endpointP95Ms,
      errorRateWarnPercent: c.thresholds.errorRateWarnPercent,
      errorRateCritPercent: c.thresholds.errorRateCritPercent,
      sampleRate: c.sampleRate,
      captureBodies: c.captureBodies,
      flushMs: c.flushMs,
      requestLogSize: c.requestLogSize,
      retention: TIER_ORDER.map((tier) => ({
        tier,
        resolutionSec: TRAFFIC_TIERS[tier].seconds,
        retentionHours: TRAFFIC_TIERS[tier].ttlSec / 3600,
      })),
    };
  }
}

function mergeAll(aggs: EndpointAgg[]): EndpointAgg {
  return aggs.reduce((acc, a) => mergeAgg(acc, a), emptyAgg());
}

/** Bỏ các field chi tiết, chỉ giữ phần summary. */
function toSummary(r: RequestSummary): RequestSummary {
  const {
    id,
    at,
    method,
    routeId,
    route,
    path,
    status,
    durationMs,
    instance,
    correlationId,
    errorCode,
    captured,
  } = r;
  return {
    id,
    at,
    method,
    routeId,
    route,
    path,
    status,
    durationMs,
    instance,
    correlationId,
    errorCode,
    captured,
  };
}

function unknownRoute(id: string): TrafficRoute {
  return { id, method: '?', route: UNMATCHED_ROUTE, module: UNMATCHED_ROUTE, internal: false };
}

/** Thời điểm bắt đầu của chuỗi bucket liên tiếp (tính từ hiện tại) thoả điều kiện. */
function sinceOf(
  buckets: BucketAgg[],
  predicate: (agg: EndpointAgg) => boolean,
  accept: RouteFilter,
): string | null {
  let since: number | null = null;
  for (let i = buckets.length - 1; i >= 0; i--) {
    const agg = totalOf([buckets[i]!], accept);
    if (agg.n === 0) continue;
    if (!predicate(agg)) break;
    since = buckets[i]!.start;
  }
  return since === null ? null : new Date(since).toISOString();
}

const byNumberDesc =
  (pick: (r: EndpointRowDto) => number | null) => (a: EndpointRowDto, b: EndpointRowDto) =>
    (pick(b) ?? -1) - (pick(a) ?? -1) || b.stats.requests - a.stats.requests;

const ENDPOINT_COMPARATORS: Record<EndpointSort, (a: EndpointRowDto, b: EndpointRowDto) => number> =
  {
    traffic: byNumberDesc((r) => r.stats.requests),
    latency: byNumberDesc((r) => r.stats.avgLatencyMs),
    p95: byNumberDesc((r) => r.stats.p95LatencyMs),
    errors: (a, b) =>
      b.stats.errorRatePercent - a.stats.errorRatePercent ||
      b.stats.clientErrorRatePercent - a.stats.clientErrorRatePercent ||
      b.stats.requests - a.stats.requests,
  };

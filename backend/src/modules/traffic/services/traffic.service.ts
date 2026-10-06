import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import {
  PrometheusQueryClient,
  PrometheusUnavailableError,
  type PromSample,
} from '@packages/metrics/index.js';
import {
  TrafficEndpointNotFoundException,
  TrafficTelemetryUnavailableException,
} from '../exceptions/traffic.exceptions.js';
import type {
  EndpointDetailDto,
  EndpointRowDto,
  EndpointStatus,
  ErrorAnalysisDto,
  StatusClass,
  TimeseriesDto,
  TimeseriesMetric,
  TrafficInsightsDto,
  TrafficSettingsDto,
  TrafficStatsDto,
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

const STATUS_CLASSES: StatusClass[] = ['2xx', '3xx', '4xx', '5xx'];

const routeKey = (labels: Record<string, string>) =>
  `${labels['method'] || 'GET'} ${labels['route'] || '/'}`;

const byRoute = (samples: PromSample[]) =>
  new Map(samples.map((item) => [routeKey(item.labels), item.value]));

const toMs = (sec: number | null | undefined) =>
  sec === null || sec === undefined ? null : Math.round(sec * 1000);

/** Route nội bộ (System Console, health check) — cùng quy ước với cột `internal` của endpoint. */
const isInternal = (route: string) => route.includes('/ops/') || route.includes('/health');
const INTERNAL_ROUTE_RE = '.*(/ops/|/health).*';

const percentOf = (part: number, total: number) =>
  total > 0 ? Number(((part / total) * 100).toFixed(2)) : 0;

export interface TrafficQuery {
  range: TrafficRange;
  instance?: string | undefined;
  method?: string | undefined;
  module?: string | undefined;
  routeId?: string | undefined;
  includeInternal: boolean;
}

@Injectable()
export class TrafficService {
  constructor(
    private readonly prom: PrometheusQueryClient,
    private readonly config: CoreConfigService,
    private readonly i18n: CoreI18nService,
  ) {}

  /** Prometheus không cấu hình/không trả lời → 503, thay vì số 0 trông như "không có traffic". */
  private async must<T>(task: Promise<T>): Promise<T> {
    try {
      return await task;
    } catch (err) {
      if (err instanceof PrometheusUnavailableError)
        throw new TrafficTelemetryUnavailableException();
      throw err;
    }
  }

  public async getSummary(q: TrafficQuery): Promise<TrafficSummaryDto> {
    const minutes = TRAFFIC_RANGES[q.range] ?? 15;
    const w = `${minutes}m`;
    const sel = q.includeInternal ? '' : `{route!~"${INTERNAL_ROUTE_RE}"}`;

    const [statusSamples, sumDuration, p50, p95, p99] = await Promise.all([
      this.must(
        this.prom.query(
          `sum by (status) (increase(http_request_duration_seconds_count${sel}[${w}]))`,
        ),
      ),
      this.prom.value(`sum(increase(http_request_duration_seconds_sum${sel}[${w}]))`),
      this.prom.value(
        `histogram_quantile(0.50, sum by (le) (rate(http_request_duration_seconds_bucket${sel}[${w}])))`,
      ),
      this.prom.value(
        `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket${sel}[${w}])))`,
      ),
      this.prom.value(
        `histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket${sel}[${w}])))`,
      ),
    ]);

    const classCounts = new Map<StatusClass, number>(STATUS_CLASSES.map((c) => [c, 0]));
    for (const s of statusSamples) {
      const cls = `${s.labels['status']?.[0] ?? ''}xx` as StatusClass;
      if (classCounts.has(cls)) classCounts.set(cls, classCounts.get(cls)! + Math.round(s.value));
    }
    const requests = [...classCounts.values()].reduce((a, b) => a + b, 0);
    const serverErrors = classCounts.get('5xx')!;
    const clientErrors = classCounts.get('4xx')!;
    const durationSec = minutes * 60;
    const requestsPerSecond = Number((requests / durationSec).toFixed(2));
    const avgLatencyMs =
      requests > 0 && sumDuration !== null
        ? Number(((sumDuration / requests) * 1000).toFixed(1))
        : null;
    const p50LatencyMs = toMs(p50);
    const p95LatencyMs = toMs(p95);
    const p99LatencyMs = toMs(p99);
    const errorRatePercent = percentOf(serverErrors, requests);
    const clientErrorRatePercent = percentOf(clientErrors, requests);

    const stats: TrafficStatsDto = {
      requests,
      requestsPerSecond,
      avgLatencyMs,
      p50LatencyMs,
      p95LatencyMs,
      p99LatencyMs,
      clientErrors,
      serverErrors,
      errorRatePercent,
      clientErrorRatePercent,
    };

    const statusClasses = STATUS_CLASSES.map((cls) => {
      const count = classCounts.get(cls)!;
      return {
        class: cls,
        count,
        percent: requests > 0 ? Number(((count / requests) * 100).toFixed(1)) : 0,
      };
    });

    const topStatuses = statusSamples
      .map((s) => ({
        status: Number(s.labels['status']) || 200,
        count: Math.round(s.value),
      }))
      .filter((s) => s.count > 0)
      .sort((a, b) => b.count - a.count);

    const settings: TrafficSettingsDto = {
      slowMs: 1000,
      longRunningMs: 5000,
      endpointP95WarnMs: 500,
      errorRateWarnPercent: 1,
      errorRateCritPercent: 5,
      sampleRate: 1,
      captureBodies: false,
      flushMs: 5000,
      requestLogSize: 1000,
      retention: [],
    };

    return {
      range: q.range,
      generatedAt: new Date().toISOString(),
      instances: ['api'],
      modules: ['core'],
      stats,
      comparison: { requestsPercent: null, p95Percent: null, errorRateDelta: null },
      activeRequests: 0,
      peakActiveRequests: 0,
      requestsToday: requests,
      hasTraffic: requests > 0,
      lastRequestAt: requests > 0 ? new Date().toISOString() : null,
      statusClasses,
      topStatuses,
      settings,
    };
  }

  public async getTimeseries(q: TrafficQuery, metric: TimeseriesMetric): Promise<TimeseriesDto> {
    const minutes = TRAFFIC_RANGES[q.range] ?? 15;
    const stepSec = Math.max(10, Math.round((minutes * 60) / 60));

    let expr = '';
    let unit: 'rps' | 'ms' | 'percent' = 'rps';
    if (metric === 'latency') {
      expr = `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[1m]))) * 1000`;
      unit = 'ms';
    } else if (metric === 'errors') {
      expr = `sum(rate(http_request_duration_seconds_count{status=~"5.."}[1m]))`;
      unit = 'rps';
    } else {
      expr = `sum(rate(http_request_duration_seconds_count[1m]))`;
      unit = 'rps';
    }

    const seriesList = await this.must(this.prom.range(expr, minutes, stepSec));
    const points =
      seriesList[0]?.points.map((p) => ({ t: p.t, value: Number(p.v.toFixed(2)) })) ?? [];
    const values = points.map((p) => p.value);
    const current = values.length > 0 ? (values.at(-1) ?? null) : null;
    const average =
      values.length > 0
        ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2))
        : null;
    const peak = values.length > 0 ? Math.max(...values) : null;
    const peakAt = peak !== null ? (points.find((p) => p.value === peak)?.t ?? null) : null;

    return {
      range: q.range,
      metric,
      stepSec,
      unit,
      series: [{ id: metric, points }],
      current,
      average,
      peak,
      peakAt,
    };
  }

  public async getEndpoints(q: TrafficQuery, sort: EndpointSort): Promise<EndpointRowDto[]> {
    const minutes = TRAFFIC_RANGES[q.range] ?? 15;
    const w = `${minutes}m`;
    const durationSec = minutes * 60;

    const quantile = (q: number) =>
      this.prom.safeQuery(
        `histogram_quantile(${q}, sum by (le, route, method) (rate(http_request_duration_seconds_bucket[${w}])))`,
      );
    const [counts, sums, p50s, p95s, p99s, errors5xx, errors4xx] = await Promise.all([
      this.must(
        this.prom.query(
          `sum by (route, method) (increase(http_request_duration_seconds_count[${w}]))`,
        ),
      ),
      this.prom.safeQuery(
        `sum by (route, method) (increase(http_request_duration_seconds_sum[${w}]))`,
      ),
      quantile(0.5),
      quantile(0.95),
      quantile(0.99),
      this.prom.safeQuery(
        `sum by (route, method) (increase(http_request_duration_seconds_count{status=~"5.."}[${w}]))`,
      ),
      this.prom.safeQuery(
        `sum by (route, method) (increase(http_request_duration_seconds_count{status=~"4.."}[${w}]))`,
      ),
    ]);
    const sumMap = byRoute(sums);
    const p50Map = byRoute(p50s);
    const p95Map = byRoute(p95s);
    const p99Map = byRoute(p99s);
    const errMap = byRoute(errors5xx);
    const clientErrMap = byRoute(errors4xx);

    const rows: EndpointRowDto[] = [];
    for (const item of counts) {
      const method = item.labels['method'] || 'GET';
      const route = item.labels['route'] || '/';
      const key = routeKey(item.labels);
      const reqCount = Math.round(item.value);
      const sumSec = sumMap.get(key);
      const avgLatencyMs =
        reqCount > 0 && sumSec !== undefined
          ? Number(((sumSec / reqCount) * 1000).toFixed(1))
          : null;
      const p95LatencyMs = toMs(p95Map.get(key));
      const serverErr = Math.round(errMap.get(key) ?? 0);
      const clientErr = Math.round(clientErrMap.get(key) ?? 0);
      const errorRatePercent = percentOf(serverErr, reqCount);
      const clientErrorRatePercent = percentOf(clientErr, reqCount);

      const internal = isInternal(route);
      if (!q.includeInternal && internal) continue;
      if (q.method && q.method !== method) continue;
      if (q.routeId && q.routeId !== key) continue;

      const segments = route.split('/').filter(Boolean);
      const moduleName = segments[1] || segments[0] || 'root';

      let status: EndpointStatus = 'healthy';
      if (errorRatePercent > 10) status = 'failing';
      else if (p95LatencyMs && p95LatencyMs > 1000) status = 'slow';
      else if (reqCount === 0) status = 'idle';

      rows.push({
        id: key,
        method,
        route,
        module: moduleName,
        internal,
        stats: {
          requests: reqCount,
          requestsPerSecond: Number((reqCount / durationSec).toFixed(2)),
          avgLatencyMs,
          p50LatencyMs: toMs(p50Map.get(key)),
          p95LatencyMs,
          p99LatencyMs: toMs(p99Map.get(key)),
          clientErrors: clientErr,
          serverErrors: serverErr,
          errorRatePercent,
          clientErrorRatePercent,
        },
        status,
        reasons: [],
      });
    }

    if (sort === 'p95') {
      rows.sort((a, b) => (b.stats.p95LatencyMs ?? 0) - (a.stats.p95LatencyMs ?? 0));
    } else if (sort === 'latency') {
      rows.sort((a, b) => (b.stats.avgLatencyMs ?? 0) - (a.stats.avgLatencyMs ?? 0));
    } else if (sort === 'errors') {
      rows.sort((a, b) => b.stats.errorRatePercent - a.stats.errorRatePercent);
    } else {
      rows.sort((a, b) => b.stats.requests - a.stats.requests);
    }

    return rows;
  }

  public async getEndpoint(routeId: string, q: TrafficQuery): Promise<EndpointDetailDto> {
    const endpoints = await this.getEndpoints({ ...q, includeInternal: true }, 'traffic');
    const ep =
      endpoints.find((e) => e.id === routeId || e.route === routeId) ??
      endpoints.find((e) => e.id.toLowerCase() === routeId.toLowerCase());
    if (!ep) {
      throw new TrafficEndpointNotFoundException(routeId);
    }

    return {
      ...ep,
      range: q.range,
      comparison: { requestsPercent: null, p95Percent: null, errorRateDelta: null },
      requestsToday: ep.stats.requests,
      topStatuses: [{ status: 200, count: ep.stats.requests }],
      topErrorCodes: [],
    };
  }

  public async getErrors(q: TrafficQuery): Promise<ErrorAnalysisDto> {
    const summary = await this.getSummary(q);
    const endpoints = await this.getEndpoints({ ...q, includeInternal: true }, 'errors');
    const topRoutes = endpoints
      .filter((e) => e.stats.serverErrors > 0 || e.stats.clientErrors > 0)
      .map((e) => ({
        routeId: e.id,
        method: e.method,
        route: e.route,
        clientErrors: e.stats.clientErrors,
        serverErrors: e.stats.serverErrors,
      }));

    return {
      range: q.range,
      stats: summary.stats,
      topRoutes,
      topCodes: [],
      topStatuses: summary.topStatuses,
    };
  }

  public async getInsights(q: TrafficQuery): Promise<TrafficInsightsDto> {
    const summary = await this.getSummary(q);
    return {
      generatedAt: new Date().toISOString(),
      problems: [],
      security: [],
      rateLimit: { configured: false, message: 'Rate limit not configured' },
      last24h: {
        total: summary.stats.requests,
        successful: Math.max(0, summary.stats.requests - summary.stats.serverErrors),
        clientErrors: summary.stats.clientErrors,
        serverErrors: summary.stats.serverErrors,
        peak: null,
        slowest: null,
      },
    };
  }
}

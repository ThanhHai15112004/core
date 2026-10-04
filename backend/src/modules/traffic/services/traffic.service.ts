import { Injectable } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { PrometheusQueryClient } from '@packages/metrics/index.js';
import {
  TrafficEndpointNotFoundException,
  TrafficRequestNotFoundException,
} from '../exceptions/traffic.exceptions.js';
import type {
  ActiveRequestsDto,
  EndpointDetailDto,
  EndpointRowDto,
  EndpointStatus,
  ErrorAnalysisDto,
  RequestDetailDto,
  RequestListDto,
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
  kind?: 'failed' | 'slow' | 'notable' | undefined;
  offset: number;
  limit: number;
}

@Injectable()
export class TrafficService {
  constructor(
    private readonly prom: PrometheusQueryClient,
    private readonly config: CoreConfigService,
    private readonly i18n: CoreI18nService,
  ) {}

  public slowThresholdMs(): number {
    return 1000;
  }

  public async getSummary(q: TrafficQuery): Promise<TrafficSummaryDto> {
    const minutes = TRAFFIC_RANGES[q.range] ?? 15;
    const w = `${minutes}m`;

    const [total, errors5xx, errors4xx, sumDuration, p50, p95, p99, statusSamples] =
      await Promise.all([
        this.prom.value(`sum(increase(http_request_duration_seconds_count[${w}]))`),
        this.prom.value(`sum(increase(http_request_duration_seconds_count{status=~"5.."}[${w}]))`),
        this.prom.value(`sum(increase(http_request_duration_seconds_count{status=~"4.."}[${w}]))`),
        this.prom.value(`sum(increase(http_request_duration_seconds_sum[${w}]))`),
        this.prom.value(
          `histogram_quantile(0.50, sum by (le) (rate(http_request_duration_seconds_bucket[${w}])))`,
        ),
        this.prom.value(
          `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[${w}])))`,
        ),
        this.prom.value(
          `histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[${w}])))`,
        ),
        this.prom.safeQuery(
          `sum by (status) (increase(http_request_duration_seconds_count[${w}]))`,
        ),
      ]);

    const requests = Math.round(total ?? 0);
    const serverErrors = Math.round(errors5xx ?? 0);
    const clientErrors = Math.round(errors4xx ?? 0);
    const durationSec = minutes * 60;
    const requestsPerSecond = Number((requests / durationSec).toFixed(2));
    const avgLatencyMs =
      requests > 0 && sumDuration !== null
        ? Number(((sumDuration / requests) * 1000).toFixed(1))
        : null;
    const p50LatencyMs = p50 !== null ? Math.round(p50 * 1000) : null;
    const p95LatencyMs = p95 !== null ? Math.round(p95 * 1000) : null;
    const p99LatencyMs = p99 !== null ? Math.round(p99 * 1000) : null;
    const errorRatePercent =
      requests > 0 ? Number(((serverErrors / requests) * 100).toFixed(2)) : 0;
    const clientErrorRatePercent =
      requests > 0 ? Number(((clientErrors / requests) * 100).toFixed(2)) : 0;

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

    const status2xx = Math.max(0, requests - clientErrors - serverErrors);
    const statusClasses: { class: StatusClass; count: number; percent: number }[] = [
      {
        class: '2xx',
        count: status2xx,
        percent: requests > 0 ? Number(((status2xx / requests) * 100).toFixed(1)) : 100,
      },
      {
        class: '3xx',
        count: 0,
        percent: 0,
      },
      {
        class: '4xx',
        count: clientErrors,
        percent: requests > 0 ? Number(((clientErrors / requests) * 100).toFixed(1)) : 0,
      },
      {
        class: '5xx',
        count: serverErrors,
        percent: requests > 0 ? Number(((serverErrors / requests) * 100).toFixed(1)) : 0,
      },
    ];

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

    const seriesList = await this.prom.safeRange(expr, minutes, stepSec);
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

    const [counts, p95s, errors5xx, errors4xx] = await Promise.all([
      this.prom.safeQuery(
        `sum by (route, method) (increase(http_request_duration_seconds_count[${w}]))`,
      ),
      this.prom.safeQuery(
        `histogram_quantile(0.95, sum by (le, route, method) (rate(http_request_duration_seconds_bucket[${w}])))`,
      ),
      this.prom.safeQuery(
        `sum by (route, method) (increase(http_request_duration_seconds_count{status=~"5.."}[${w}]))`,
      ),
      this.prom.safeQuery(
        `sum by (route, method) (increase(http_request_duration_seconds_count{status=~"4.."}[${w}]))`,
      ),
    ]);

    const p95Map = new Map<string, number>();
    for (const item of p95s) {
      const key = `${item.labels['method'] || 'GET'} ${item.labels['route'] || '/'}`;
      p95Map.set(key, item.value);
    }
    const errMap = new Map<string, number>();
    for (const item of errors5xx) {
      const key = `${item.labels['method'] || 'GET'} ${item.labels['route'] || '/'}`;
      errMap.set(key, item.value);
    }
    const clientErrMap = new Map<string, number>();
    for (const item of errors4xx) {
      const key = `${item.labels['method'] || 'GET'} ${item.labels['route'] || '/'}`;
      clientErrMap.set(key, item.value);
    }

    const rows: EndpointRowDto[] = [];
    for (const item of counts) {
      const method = item.labels['method'] || 'GET';
      const route = item.labels['route'] || '/';
      const key = `${method} ${route}`;
      const reqCount = Math.round(item.value);
      const rawP95 = p95Map.get(key) ?? null;
      const p95LatencyMs = rawP95 !== null ? Math.round(rawP95 * 1000) : null;
      const serverErr = Math.round(errMap.get(key) ?? 0);
      const clientErr = Math.round(clientErrMap.get(key) ?? 0);
      const errorRatePercent = reqCount > 0 ? Number(((serverErr / reqCount) * 100).toFixed(2)) : 0;
      const clientErrorRatePercent =
        reqCount > 0 ? Number(((clientErr / reqCount) * 100).toFixed(2)) : 0;

      const internal = route.includes('/ops/') || route.includes('/health');
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
          avgLatencyMs: p95LatencyMs,
          p50LatencyMs: p95LatencyMs ? Math.round(p95LatencyMs * 0.7) : null,
          p95LatencyMs,
          p99LatencyMs: p95LatencyMs ? Math.round(p95LatencyMs * 1.3) : null,
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

  public async getRequests(_q: RequestQuery): Promise<RequestListDto> {
    return {
      items: [],
      total: 0,
      nextOffset: null,
      retained: 0,
    };
  }

  public async getRequest(requestId: string): Promise<RequestDetailDto> {
    throw new TrafficRequestNotFoundException(requestId);
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

  public async getActive(_q: unknown): Promise<ActiveRequestsDto> {
    return {
      generatedAt: new Date().toISOString(),
      longRunningMs: 5000,
      items: [],
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

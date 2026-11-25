import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { DatabaseConnectionService, readPoolStats } from '@packages/database/index.js';
import { CircuitBreakerRegistry, HttpClientMetricsService } from '@packages/http-client/index.js';
import { safeJsonParse } from '@packages/kernel/index.js';
import { MetricsRegistryService, PrometheusQueryClient } from '@packages/metrics/index.js';
import { QueueMonitoringService } from '@packages/queue/index.js';
import { RedisService } from '@packages/redis/index.js';
import {
  LONG_RUNNING_RUNTIMES,
  runtimeKeys,
  type RuntimeHeartbeat,
} from '@packages/runtime/index.js';
import { ALERT_METRIC_KEY, type AlertMetricKey } from '../enum/metrics-ops.enum.js';
import {
  buildLocalHttpSnapshot,
  readLocalHistogramQuantiles,
} from '../helpers/metrics-local-reader.helper.js';
import {
  queryPromDbPool,
  queryPromHttpSummary,
  queryPromInstances,
  queryPromProviders,
  queryPromQueues,
  queryPromRedisLatency,
} from '../helpers/metrics-prom-reader.helper.js';
import type {
  DbPoolMetricSummary,
  InstanceResourceMetricItem,
  MetricSamplePoint,
  MetricsOverviewView,
  MetricsTelemetrySource,
  ModuleErrorMetricItem,
  ProviderLatencyMetricItem,
  QueueMetricItem,
  RedisDependencyLatencySummary,
} from '../types/metrics-ops.types.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class MetricsCollectorQueryService {
  constructor(
    private readonly config: CoreConfigService,
    @Optional() private readonly prom?: PrometheusQueryClient,
    @Optional() private readonly metricsRegistry?: MetricsRegistryService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly dbConnection?: DatabaseConnectionService,
    @Optional() private readonly queueMonitoring?: QueueMonitoringService,
    @Optional() private readonly httpClientMetrics?: HttpClientMetricsService,
    @Optional() private readonly circuitBreaker?: CircuitBreakerRegistry,
  ) {}

  public async getOverview(rangeMinutes = 15): Promise<Omit<MetricsOverviewView, 'activeAlerts'>> {
    const windowSec = Math.max(60, Math.round(rangeMinutes * 60));
    const version = this.config.app.version;
    const promReady = Boolean(this.prom?.configured);

    const promHttp =
      promReady && this.prom ? await queryPromHttpSummary(this.prom, rangeMinutes, version) : null;
    const source: MetricsTelemetrySource = promHttp ? 'prometheus' : 'local';

    const localMetrics = this.metricsRegistry
      ? await this.metricsRegistry.getMetricsJson().catch(() => [])
      : [];
    const http =
      promHttp ??
      (() => {
        const snap = buildLocalHttpSnapshot(localMetrics, version, windowSec);
        return {
          ...snap,
          requestsPerSecond: round2(snap.totalRequests / windowSec),
        };
      })();

    const [instances, database, queues, dependencies] = await Promise.all([
      this.collectInstances(source, version),
      this.collectDatabasePool(source),
      this.collectQueues(source),
      this.getDependencies(rangeMinutes, source, localMetrics),
    ]);

    return {
      source,
      rangeMinutes,
      collectedAt: new Date().toISOString(),
      http: {
        totalRequests: http.totalRequests,
        requestsPerSecond: http.requestsPerSecond,
        errors4xx: http.errors4xx,
        errors5xx: http.errors5xx,
        errorRatePercent: http.errorRatePercent,
        p50Ms: http.p50Ms,
        p95Ms: http.p95Ms,
        p99Ms: http.p99Ms,
        byStatus: http.byStatus,
        byEndpoint: http.byEndpoint,
      },
      errorsByModule: http.errorsByModule,
      instances,
      database,
      queues,
      redis: dependencies.redis,
      providers: dependencies.providers,
    };
  }

  public async getErrorsByModule(rangeMinutes = 15): Promise<ModuleErrorMetricItem[]> {
    const version = this.config.app.version;
    if (this.prom?.configured) {
      const promHttp = await queryPromHttpSummary(this.prom, rangeMinutes, version);
      if (promHttp) return promHttp.errorsByModule;
    }
    const localMetrics = this.metricsRegistry
      ? await this.metricsRegistry.getMetricsJson().catch(() => [])
      : [];
    return buildLocalHttpSnapshot(localMetrics, version, Math.max(60, rangeMinutes * 60))
      .errorsByModule;
  }

  public async getDependencies(
    rangeMinutes = 15,
    preferredSource?: MetricsTelemetrySource,
    cachedLocalMetrics?: Awaited<ReturnType<MetricsRegistryService['getMetricsJson']>>,
  ): Promise<{
    redis: RedisDependencyLatencySummary;
    providers: ProviderLatencyMetricItem[];
  }> {
    const useProm = preferredSource !== 'local' && Boolean(this.prom?.configured);
    const promRedis =
      useProm && this.prom ? await queryPromRedisLatency(this.prom, rangeMinutes) : null;
    const promProviders =
      useProm && this.prom ? await queryPromProviders(this.prom, rangeMinutes) : [];

    const redisSnap = this.redis?.getLatencySnapshot() ?? {
      count: 0,
      avgMs: null,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      lastPingMs: null,
    };
    const redisStatus = this.redis?.isReady() ? 'connected' : 'disconnected';
    const redis: RedisDependencyLatencySummary = {
      status: redisStatus,
      sampleCount: redisSnap.count,
      pingMs: promRedis?.pingMs ?? redisSnap.lastPingMs,
      avgMs: redisSnap.avgMs,
      p50Ms: promRedis?.p50Ms ?? redisSnap.p50Ms,
      p95Ms: promRedis?.p95Ms ?? redisSnap.p95Ms,
      p99Ms: promRedis?.p99Ms ?? redisSnap.p99Ms,
    };

    const providers = await this.mergeProviders(promProviders, cachedLocalMetrics);
    return { redis, providers };
  }

  public async sampleMetricForRule(
    metricKey: AlertMetricKey,
    windowSeconds: number,
  ): Promise<MetricSamplePoint[]> {
    const overview = await this.getOverview(Math.max(1, Math.round(windowSeconds / 60)));
    switch (metricKey) {
      case ALERT_METRIC_KEY.HTTP_REQUEST_RATE:
        return [{ value: overview.http.requestsPerSecond, labels: {} }];
      case ALERT_METRIC_KEY.HTTP_ERROR_RATE:
        return overview.errorsByModule.length > 0
          ? overview.errorsByModule.map((m) => ({
              value: m.errorRatePercent,
              labels: { module: m.module, version: m.version },
            }))
          : [{ value: overview.http.errorRatePercent, labels: {} }];
      case ALERT_METRIC_KEY.HTTP_LATENCY_P50:
        return overview.http.p50Ms !== null ? [{ value: overview.http.p50Ms, labels: {} }] : [];
      case ALERT_METRIC_KEY.HTTP_LATENCY_P95:
        return overview.http.p95Ms !== null ? [{ value: overview.http.p95Ms, labels: {} }] : [];
      case ALERT_METRIC_KEY.HTTP_LATENCY_P99:
        return overview.http.p99Ms !== null ? [{ value: overview.http.p99Ms, labels: {} }] : [];
      case ALERT_METRIC_KEY.RUNTIME_CPU_PERCENT:
        return overview.instances
          .filter((i) => i.cpuPercent !== null)
          .map((i) => ({
            value: i.cpuPercent!,
            labels: { runtime: i.runtime, instance: i.instance, version: i.version },
          }));
      case ALERT_METRIC_KEY.RUNTIME_MEMORY_PERCENT:
        return overview.instances
          .filter((i) => i.memoryPercent !== null)
          .map((i) => ({
            value: i.memoryPercent!,
            labels: { runtime: i.runtime, instance: i.instance, version: i.version },
          }));
      case ALERT_METRIC_KEY.RUNTIME_EVENT_LOOP_P99_MS:
        return overview.instances
          .filter((i) => i.eventLoopP99Ms !== null)
          .map((i) => ({
            value: i.eventLoopP99Ms!,
            labels: { runtime: i.runtime, instance: i.instance, version: i.version },
          }));
      case ALERT_METRIC_KEY.DB_POOL_UTILIZATION_PERCENT:
        return overview.database.utilizationPercent !== null
          ? [{ value: overview.database.utilizationPercent, labels: {} }]
          : [];
      case ALERT_METRIC_KEY.DB_POOL_WAITING:
        return overview.database.waiting !== null
          ? [{ value: overview.database.waiting, labels: {} }]
          : [];
      case ALERT_METRIC_KEY.QUEUE_BACKLOG:
        return overview.queues.map((q) => ({ value: q.backlog, labels: { queue: q.queue } }));
      case ALERT_METRIC_KEY.QUEUE_OLDEST_JOB_AGE_SEC:
        return overview.queues
          .filter((q) => q.oldestJobAgeSec !== null)
          .map((q) => ({ value: q.oldestJobAgeSec!, labels: { queue: q.queue } }));
      case ALERT_METRIC_KEY.REDIS_LATENCY_P95_MS:
        return overview.redis.p95Ms !== null ? [{ value: overview.redis.p95Ms, labels: {} }] : [];
      case ALERT_METRIC_KEY.PROVIDER_LATENCY_P95_MS:
        return overview.providers
          .filter((p) => p.p95Ms !== null)
          .map((p) => ({ value: p.p95Ms!, labels: { provider: p.provider } }));
      default:
        return [];
    }
  }

  private async collectInstances(
    source: MetricsTelemetrySource,
    defaultVersion: string,
  ): Promise<InstanceResourceMetricItem[]> {
    const fromRedis = await this.readRedisInstances(defaultVersion);
    if (source === 'prometheus' && this.prom) {
      const promInstances = await queryPromInstances(this.prom, defaultVersion);
      if (promInstances.length > 0) {
        const hbByKey = new Map(fromRedis.map((i) => [`${i.runtime}::${i.instance}`, i]));
        return promInstances.map((p) => {
          const hb = hbByKey.get(`${p.runtime}::${p.instance}`);
          return {
            ...p,
            memoryPercent: hb?.memoryPercent ?? p.memoryPercent,
            eventLoopMeanMs: hb?.eventLoopMeanMs ?? p.eventLoopMeanMs,
            eventLoopP99Ms: p.eventLoopP99Ms ?? hb?.eventLoopP99Ms ?? null,
            uptimeSec: hb?.uptimeSec ?? p.uptimeSec,
            status: hb?.status ?? p.status,
          };
        });
      }
    }
    return fromRedis;
  }

  private async readRedisInstances(defaultVersion: string): Promise<InstanceResourceMetricItem[]> {
    if (!this.redis?.isReady()) return [];
    const keys = runtimeKeys(this.redis);
    const items: InstanceResourceMetricItem[] = [];

    for (const runtimeId of LONG_RUNNING_RUNTIMES) {
      const members = await this.redis.client
        .smembers(keys.instanceIndex(runtimeId))
        .catch(() => [] as string[]);
      const rawHeartbeats: Array<string | null> =
        members.length > 0
          ? await Promise.all(
              members.map((inst) =>
                this.redis!.client.get(keys.instanceHeartbeat(runtimeId, inst)).catch(() => null),
              ),
            )
          : [await this.redis.client.get(keys.heartbeat(runtimeId)).catch(() => null)];

      for (const raw of rawHeartbeats) {
        if (!raw) continue;
        const hb = safeJsonParse<RuntimeHeartbeat | null>(raw, null);
        if (!hb) continue;
        items.push({
          runtime: hb.id,
          instance: hb.instance,
          version: defaultVersion,
          cpuPercent: hb.resources?.cpuPercent ?? null,
          memoryPercent: hb.resources?.memoryPercent ?? null,
          rssMb: hb.resources?.rssMb ?? null,
          heapUsedMb: hb.resources?.heapUsedMb ?? null,
          eventLoopMeanMs: hb.resources?.eventLoopMeanMs ?? null,
          eventLoopP99Ms: hb.resources?.eventLoopP99Ms ?? null,
          uptimeSec: hb.uptimeSec ?? null,
          status: hb.state ?? 'running',
        });
      }
    }
    return items;
  }

  private async collectDatabasePool(source: MetricsTelemetrySource): Promise<DbPoolMetricSummary> {
    const dbState = this.dbConnection?.getStatus().state ?? 'unknown';
    if (source === 'prometheus' && this.prom) {
      const promPool = await queryPromDbPool(this.prom, dbState);
      if (promPool) return promPool;
    }

    const pool = readPoolStats(this.dbConnection?.connected()?.driver);
    const limit = this.config.database.maxConnections;
    const used = pool?.used ?? null;
    const utilizationPercent = used !== null && limit > 0 ? round2((used / limit) * 100) : null;
    return {
      state: dbState,
      used,
      idle: pool?.idle ?? null,
      waiting: pool?.waiting ?? null,
      limit,
      utilizationPercent,
      sessions: null,
    };
  }

  private async collectQueues(source: MetricsTelemetrySource): Promise<QueueMetricItem[]> {
    if (this.queueMonitoring?.usable()) {
      const now = Date.now();
      const liveQueues = await this.queueMonitoring.queues().catch(() => null);
      if (liveQueues) {
        return liveQueues.map((q) => {
          const waiting = q.counts.waiting + (q.counts.prioritized ?? 0);
          const delayed = q.counts.delayed;
          return {
            queue: q.name,
            waiting,
            active: q.counts.active,
            delayed,
            failed: q.counts.failed,
            backlog: waiting + delayed,
            oldestJobAgeSec:
              q.oldestWaitingAt === null
                ? 0
                : Math.max(0, round2((now - q.oldestWaitingAt) / 1000)),
            paused: q.paused,
          };
        });
      }
    }
    if (source === 'prometheus' && this.prom) {
      const promQueues = await queryPromQueues(this.prom);
      if (promQueues) return promQueues;
    }
    return [];
  }

  private async mergeProviders(
    promProviders: readonly ProviderLatencyMetricItem[],
    cachedLocalMetrics?: Awaited<ReturnType<MetricsRegistryService['getMetricsJson']>>,
  ): Promise<ProviderLatencyMetricItem[]> {
    const circuits = new Map(
      (this.circuitBreaker?.listSnapshots() ?? []).map((c) => [c.service, c.state]),
    );
    if (promProviders.length > 0) {
      return promProviders.map((p) => ({
        ...p,
        circuitState: p.circuitState ?? circuits.get(p.provider) ?? null,
      }));
    }

    const localMetrics =
      cachedLocalMetrics ??
      (this.metricsRegistry ? await this.metricsRegistry.getMetricsJson().catch(() => []) : []);
    const outQuantiles = readLocalHistogramQuantiles(
      localMetrics,
      'outbound_http_request_duration_seconds',
      'service',
    );
    const items: ProviderLatencyMetricItem[] = [];
    const seen = new Set<string>();

    for (const snap of this.httpClientMetrics?.listServiceMetrics() ?? []) {
      seen.add(snap.service);
      const q = outQuantiles.get(snap.service);
      items.push({
        provider: snap.service,
        source: 'http-client',
        requests: snap.totalRequests,
        failures: snap.failedRequests,
        errorRatePercent: snap.errorRatePercent,
        avgMs: snap.avgDurationMs,
        p50Ms: q?.p50Ms ?? null,
        p95Ms: q?.p95Ms ?? snap.p95DurationMs,
        p99Ms: q?.p99Ms ?? null,
        circuitState: circuits.get(snap.service) ?? null,
      });
    }

    for (const [svc, q] of outQuantiles.entries()) {
      if (seen.has(svc)) continue;
      items.push({
        provider: svc,
        source: 'http-client',
        requests: q.count,
        failures: 0,
        errorRatePercent: 0,
        avgMs: q.count > 0 ? round2(q.sumMs / q.count) : null,
        p50Ms: q.p50Ms,
        p95Ms: q.p95Ms,
        p99Ms: q.p99Ms,
        circuitState: circuits.get(svc) ?? null,
      });
    }

    const regQuantiles = readLocalHistogramQuantiles(
      localMetrics,
      'provider_registry_invocation_duration_seconds',
      'provider_code',
    );
    for (const [code, q] of regQuantiles.entries()) {
      items.push({
        provider: code,
        source: 'provider-registry',
        requests: q.count,
        failures: 0,
        errorRatePercent: 0,
        avgMs: q.count > 0 ? round2(q.sumMs / q.count) : null,
        p50Ms: q.p50Ms,
        p95Ms: q.p95Ms,
        p99Ms: q.p99Ms,
        circuitState: null,
      });
    }

    return items.sort((a, b) => b.requests - a.requests);
  }
}

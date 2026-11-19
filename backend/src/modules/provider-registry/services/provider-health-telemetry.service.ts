import { performance } from 'node:perf_hooks';
import {
  Inject,
  Injectable,
  Optional,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  HTTP_CLIENT_TOKEN,
  HttpClientMetricsService,
  HttpNetworkError,
  HttpStatusError,
  HttpTimeoutError,
  type HttpClientContract,
} from '@packages/http-client/index.js';
import {
  ProviderRegistryService as KernelProviderRegistryService,
  SettingRegistryService,
  defaultProviderRegistry,
  defaultSettingRegistry,
  parseNumericUserId,
  safeJsonParse,
  safeJsonParseObject,
  type PaginatedResult,
  type ProviderHealthProbeResult,
  type ProviderHealthStatusCode,
  type ProviderTypeName,
  type RecordProviderInvocationInput,
} from '@packages/kernel/index.js';
import { BaseMessagePublisherProvider, QUEUES } from '@packages/messaging/index.js';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import { SecretService, type UserIdentity } from '@packages/security/index.js';
import type { Counter, Gauge, Histogram } from 'prom-client';
import {
  ALL_PROVIDER_TYPES,
  PROVIDER_CHECK_SOURCE,
  PROVIDER_HEALTH_STATUS,
  PROVIDER_REGISTRY_EVENTS,
  PROVIDER_STATUS,
  type ProviderCheckSource,
} from '../enum/provider-registry.enum.js';
import type { ProviderMetricBucketEntity } from '../entities/provider-metric-bucket.entity.js';
import type { ProviderRegistryEntryEntity } from '../entities/provider-registry-entry.entity.js';
import { resolveProviderRegistryConfig } from '../helpers/provider-config.helper.js';
import { sanitizeProviderErrorMessage } from '../helpers/provider-redaction.helper.js';
import { validateHealthCheckUrl } from '../helpers/provider-ssrf.helper.js';
import {
  alignToMetricBucketStart,
  appendLatencySample,
  classifyHealthFromTelemetry,
  computeP95FromSamples,
  round2,
} from '../helpers/provider-telemetry.helper.js';
import { ProviderHealthCheckRepository } from '../repositories/provider-health-check.repository.js';
import { ProviderMetricBucketRepository } from '../repositories/provider-metric-bucket.repository.js';
import { ProviderRegistryEntryRepository } from '../repositories/provider-registry-entry.repository.js';
import { ProviderUnitAssignmentRepository } from '../repositories/provider-unit-assignment.repository.js';
import type {
  ListProviderHealthChecksQuery,
  RecordProviderObservationRequest,
  RunHealthCheckAllRequest,
} from '../requests/provider-registry.requests.js';
import { ProviderRegistryResponseMapper } from '../responses/provider-registry.response.js';
import type {
  ProviderDashboardProviderRow,
  ProviderDashboardTypeSummary,
  ProviderDashboardView,
  ProviderHealthCheckView,
  ProviderRegistryRuntimeConfig,
  ProviderTelemetrySummaryView,
} from '../types/provider-registry.types.js';
import { ProviderEntriesService } from './provider-entries.service.js';

@Injectable()
export class ProviderHealthTelemetryService implements OnModuleInit, OnModuleDestroy {
  private readonly kernelRegistry: KernelProviderRegistryService;
  private readonly settingRegistry: SettingRegistryService;
  private readonly healthGauge: Gauge<'provider_type' | 'provider_code'> | null;
  private readonly invocationCounter: Counter<'provider_type' | 'provider_code' | 'outcome'> | null;
  private readonly invocationDuration: Histogram<'provider_type' | 'provider_code'> | null;
  private unregisterSink: (() => void) | null = null;

  constructor(
    private readonly entryRepo: ProviderRegistryEntryRepository,
    private readonly unitRepo: ProviderUnitAssignmentRepository,
    private readonly healthCheckRepo: ProviderHealthCheckRepository,
    private readonly metricBucketRepo: ProviderMetricBucketRepository,
    private readonly entriesService: ProviderEntriesService,
    @Optional() kernelRegistry?: KernelProviderRegistryService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional()
    @Inject(HTTP_CLIENT_TOKEN)
    private readonly httpClient?: HttpClientContract,
    @Optional() private readonly httpClientMetrics?: HttpClientMetricsService,
    @Optional() private readonly secretService?: SecretService,
    @Optional() metrics?: MetricsRegistryService,
    @Optional() private readonly messagePublisher?: BaseMessagePublisherProvider,
  ) {
    this.kernelRegistry = kernelRegistry ?? defaultProviderRegistry;
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;

    if (metrics) {
      this.healthGauge = metrics.gauge(
        'provider_registry_health_status',
        'Health status of registered provider (0=UNKNOWN, 1=HEALTHY, 2=DEGRADED, 3=DOWN)',
        ['provider_type', 'provider_code'],
      );
      this.invocationCounter = metrics.counter(
        'provider_registry_invocations_total',
        'Total invocations observed per provider and outcome',
        ['provider_type', 'provider_code', 'outcome'],
      );
      this.invocationDuration = metrics.histogram(
        'provider_registry_invocation_duration_seconds',
        'Observed provider invocation latency in seconds',
        ['provider_type', 'provider_code'],
      );
    } else {
      this.healthGauge = null;
      this.invocationCounter = null;
      this.invocationDuration = null;
    }
  }

  public onModuleInit(): void {
    this.unregisterSink = this.kernelRegistry.registerInvocationSink((input) =>
      this.recordInvocationObservation(input),
    );
  }

  public onModuleDestroy(): void {
    this.unregisterSink?.();
    this.unregisterSink = null;
  }

  public async checkProviderHealth(
    id: number,
    options?: {
      readonly source?: ProviderCheckSource | undefined;
      readonly actor?: UserIdentity | undefined;
    },
  ): Promise<ProviderHealthCheckView> {
    const entry = await this.entriesService.getEntryOrThrow(id);
    const runtimeConfig = resolveProviderRegistryConfig(this.settingRegistry);
    const probeResult = await this.executeProbeForEntry(entry, runtimeConfig);
    const checkedAt = new Date();

    let nextHealthStatus = this.mapProbeStatusToCode(probeResult.status);
    let nextErrorCode = probeResult.errorCode ?? null;
    let nextErrorMessage = sanitizeProviderErrorMessage(probeResult.errorMessage);

    if (
      nextHealthStatus === PROVIDER_HEALTH_STATUS.HEALTHY &&
      probeResult.latencyMs >= runtimeConfig.degradedLatencyMs
    ) {
      nextHealthStatus = PROVIDER_HEALTH_STATUS.DEGRADED;
      nextErrorCode = nextErrorCode ?? 'HIGH_LATENCY';
      nextErrorMessage =
        nextErrorMessage ??
        `Health probe latency (${probeResult.latencyMs}ms) exceeded degraded threshold (${runtimeConfig.degradedLatencyMs}ms)`;
    }

    const prevHealthStatus = entry.healthStatus;
    const nextConsecutiveFailures =
      nextHealthStatus === PROVIDER_HEALTH_STATUS.HEALTHY
        ? 0
        : Number(entry.consecutiveFailures ?? 0) + 1;

    if (
      nextHealthStatus === PROVIDER_HEALTH_STATUS.DEGRADED &&
      nextConsecutiveFailures >= runtimeConfig.consecutiveFailuresForDown
    ) {
      nextHealthStatus = PROVIDER_HEALTH_STATUS.DOWN;
      nextErrorCode = nextErrorCode ?? 'CONSECUTIVE_DEGRADED_FAILURES';
    }

    const checkedBy = parseNumericUserId(options?.actor?.id);
    const savedCheck = await this.healthCheckRepo.saveEntity({
      providerId: Number(entry.id),
      providerType: entry.providerType,
      providerCode: entry.providerCode,
      healthStatus: nextHealthStatus,
      latencyMs: Math.max(0, Math.round(probeResult.latencyMs)),
      httpStatus: probeResult.httpStatus ?? null,
      errorCode: nextErrorCode,
      errorMessage: nextErrorMessage,
      checkSource: options?.source ?? PROVIDER_CHECK_SOURCE.MANUAL,
      detailsJson: probeResult.details ? JSON.stringify(probeResult.details) : null,
      checkedBy,
      checkedAt,
    });

    entry.healthStatus = nextHealthStatus;
    entry.lastHealthCheckAt = checkedAt;
    entry.lastHealthLatencyMs = Math.max(0, Math.round(probeResult.latencyMs));
    entry.lastHealthErrorCode = nextErrorCode;
    entry.lastHealthErrorMessage = nextErrorMessage;
    entry.consecutiveFailures = nextConsecutiveFailures;

    await this.entryRepo.saveEntity(entry);
    await this.entriesService.syncKernelSnapshot();

    this.healthGauge?.set(
      { provider_type: entry.providerType, provider_code: entry.providerCode },
      nextHealthStatus,
    );

    if (prevHealthStatus !== nextHealthStatus) {
      await this.messagePublisher
        ?.publish(
          PROVIDER_REGISTRY_EVENTS.HEALTH_CHANGED,
          {
            providerId: Number(entry.id),
            providerType: entry.providerType,
            providerCode: entry.providerCode,
            previousHealthStatus: prevHealthStatus,
            healthStatus: nextHealthStatus,
            latencyMs: entry.lastHealthLatencyMs,
            errorCode: nextErrorCode,
          },
          QUEUES.SYSTEM_EVENTS,
        )
        .catch(() => undefined);
    }

    return ProviderRegistryResponseMapper.toHealthCheckView(savedCheck);
  }

  public async checkAllProvidersHealth(
    input: RunHealthCheckAllRequest = {},
    actor?: UserIdentity,
  ): Promise<readonly ProviderHealthCheckView[]> {
    const entries = await this.entryRepo.listAll();
    const targets = entries.filter(
      (entry) =>
        entry.status !== PROVIDER_STATUS.DISABLED &&
        (!input.providerType || entry.providerType === input.providerType),
    );

    const results: ProviderHealthCheckView[] = [];
    for (const entry of targets) {
      results.push(
        await this.checkProviderHealth(Number(entry.id), {
          source: PROVIDER_CHECK_SOURCE.MANUAL,
          actor,
        }),
      );
    }
    return results;
  }

  public async listHealthChecks(
    providerId: number,
    query: Partial<ListProviderHealthChecksQuery> = {},
  ): Promise<PaginatedResult<ProviderHealthCheckView>> {
    await this.entriesService.getEntryOrThrow(providerId);
    const paged = await this.healthCheckRepo.listPaginated({
      ...query,
      providerId,
    });
    return createPaginatedResult(
      paged.data.map((item) => ProviderRegistryResponseMapper.toHealthCheckView(item)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async recordManualObservation(
    providerId: number,
    input: RecordProviderObservationRequest,
  ): Promise<{ readonly recorded: true; readonly providerId: number }> {
    const entry = await this.entriesService.getEntryOrThrow(providerId);
    await this.recordInvocationObservation({
      providerType: entry.providerType,
      providerCode: entry.providerCode,
      driverCode: entry.driverCode,
      success: input.success,
      latencyMs: input.latencyMs,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
    });
    return { recorded: true, providerId: Number(entry.id) };
  }

  public async recordInvocationObservation(input: RecordProviderInvocationInput): Promise<void> {
    const entry = await this.resolveMatchingEntry(input);
    if (!entry) return;

    const latencyMs = Math.max(0, Math.round(input.latencyMs));
    const observedAt = input.occurredAt ?? new Date();
    const bucketStart = alignToMetricBucketStart(observedAt);

    this.invocationCounter?.inc({
      provider_type: entry.providerType,
      provider_code: entry.providerCode,
      outcome: input.success ? 'success' : 'error',
    });
    this.invocationDuration?.observe(
      { provider_type: entry.providerType, provider_code: entry.providerCode },
      latencyMs / 1000,
    );

    const existing = await this.metricBucketRepo.findBucket(Number(entry.id), bucketStart);
    const prevSamples = existing?.latencySamplesJson
      ? (safeJsonParse<number[]>(existing.latencySamplesJson, []) ?? [])
      : [];
    const nextSamples = appendLatencySample(prevSamples, latencyMs);
    const nextP95 = computeP95FromSamples(nextSamples);

    const nextTotal = (existing?.totalCount ?? 0) + 1;
    const nextSuccess = (existing?.successCount ?? 0) + (input.success ? 1 : 0);
    const nextError = (existing?.errorCount ?? 0) + (input.success ? 0 : 1);
    const nextTotalLatency = (existing?.totalLatencyMs ?? 0) + latencyMs;
    const nextMinLatency =
      existing?.minLatencyMs !== null && existing?.minLatencyMs !== undefined
        ? Math.min(existing.minLatencyMs, latencyMs)
        : latencyMs;
    const nextMaxLatency =
      existing?.maxLatencyMs !== null && existing?.maxLatencyMs !== undefined
        ? Math.max(existing.maxLatencyMs, latencyMs)
        : latencyMs;

    await this.metricBucketRepo.saveEntity({
      ...(existing ? { id: existing.id } : {}),
      providerId: Number(entry.id),
      providerType: entry.providerType,
      providerCode: entry.providerCode,
      bucketStart,
      totalCount: nextTotal,
      successCount: nextSuccess,
      errorCount: nextError,
      totalLatencyMs: nextTotalLatency,
      minLatencyMs: nextMinLatency,
      maxLatencyMs: nextMaxLatency,
      p95LatencyMs: nextP95,
      latencySamplesJson: JSON.stringify(nextSamples),
      lastErrorCode: input.success
        ? (existing?.lastErrorCode ?? null)
        : input.errorCode?.trim() || 'INVOCATION_ERROR',
      lastObservedAt: observedAt,
    });

    // Passive telemetry degradation check when sufficient samples exist in active window
    const runtimeConfig = resolveProviderRegistryConfig(this.settingRegistry);
    const since = new Date(Date.now() - runtimeConfig.telemetryWindowMinutes * 60_000);
    const windowBuckets = await this.metricBucketRepo.listBucketsSince({
      since,
      providerId: Number(entry.id),
    });
    const summary = this.aggregateBuckets(windowBuckets);
    if (summary.sampleCount >= 3) {
      const passiveHealth = classifyHealthFromTelemetry({
        totalCount: summary.sampleCount,
        errorCount: summary.errorCount,
        avgLatencyMs: summary.avgLatencyMs,
        config: runtimeConfig,
      });

      if (
        passiveHealth !== PROVIDER_HEALTH_STATUS.UNKNOWN &&
        passiveHealth !== entry.healthStatus
      ) {
        entry.healthStatus = passiveHealth;
        if (!input.success && input.errorCode) {
          entry.lastHealthErrorCode = input.errorCode.trim();
          entry.lastHealthErrorMessage = sanitizeProviderErrorMessage(input.errorMessage);
        }
        await this.entryRepo.saveEntity(entry);
        await this.entriesService.syncKernelSnapshot();
        this.healthGauge?.set(
          { provider_type: entry.providerType, provider_code: entry.providerCode },
          passiveHealth,
        );
      }
    }
  }

  public async getDashboard(query?: {
    readonly providerType?: ProviderTypeName | undefined;
    readonly windowMinutes?: number | undefined;
  }): Promise<ProviderDashboardView> {
    const runtimeConfig = resolveProviderRegistryConfig(this.settingRegistry);
    const windowMinutes = query?.windowMinutes ?? runtimeConfig.telemetryWindowMinutes;
    const since = new Date(Date.now() - windowMinutes * 60_000);

    const [allEntries, assignments, buckets] = await Promise.all([
      this.entryRepo.listAll(),
      this.unitRepo.listAll(),
      this.metricBucketRepo.listBucketsSince({
        since,
        providerType: query?.providerType,
      }),
    ]);

    const entries = query?.providerType
      ? allEntries.filter((e) => e.providerType === query.providerType)
      : allEntries;

    const bucketsByProvider = new Map<number, ProviderMetricBucketEntity[]>();
    for (const bucket of buckets) {
      const pid = Number(bucket.providerId);
      const list = bucketsByProvider.get(pid) ?? [];
      list.push(bucket);
      bucketsByProvider.set(pid, list);
    }

    const providerRows: ProviderDashboardProviderRow[] = entries.map((entry) => {
      const view = this.entriesService.toSafeEntryView(entry);
      const providerBuckets = bucketsByProvider.get(Number(entry.id)) ?? [];
      const telemetry = this.aggregateBuckets(providerBuckets);
      const httpSvc = entry.httpServiceName
        ? this.httpClientMetrics?.getServiceMetrics(entry.httpServiceName)
        : undefined;

      return {
        provider: view,
        telemetry,
        httpClientMetrics: httpSvc
          ? {
              service: httpSvc.service,
              totalRequests: httpSvc.totalRequests,
              errorRatePercent: httpSvc.errorRatePercent,
              avgDurationMs: httpSvc.avgDurationMs,
              p95DurationMs: httpSvc.p95DurationMs,
            }
          : null,
      };
    });

    const targetTypes = query?.providerType ? [query.providerType] : ALL_PROVIDER_TYPES;
    const byType: ProviderDashboardTypeSummary[] = targetTypes.map((type) => {
      const rows = providerRows.filter((r) => r.provider.providerType === type);
      const primary = rows.find((r) => r.provider.isPrimary)?.provider.providerCode ?? null;
      const sampleCount = rows.reduce((acc, r) => acc + r.telemetry.sampleCount, 0);
      const errorCount = rows.reduce((acc, r) => acc + r.telemetry.errorCount, 0);
      const weightedLatencySum = rows.reduce(
        (acc, r) =>
          acc +
          (r.telemetry.avgLatencyMs !== null
            ? r.telemetry.avgLatencyMs * r.telemetry.sampleCount
            : 0),
        0,
      );

      return {
        providerType: type,
        total: rows.length,
        primaryProviderCode: primary,
        activeCount: rows.filter((r) => r.provider.status === PROVIDER_STATUS.ACTIVE).length,
        pausedCount: rows.filter((r) => r.provider.status === PROVIDER_STATUS.PAUSED).length,
        disabledCount: rows.filter((r) => r.provider.status === PROVIDER_STATUS.DISABLED).length,
        healthyCount: rows.filter((r) => r.provider.healthStatus === PROVIDER_HEALTH_STATUS.HEALTHY)
          .length,
        degradedCount: rows.filter(
          (r) => r.provider.healthStatus === PROVIDER_HEALTH_STATUS.DEGRADED,
        ).length,
        downCount: rows.filter((r) => r.provider.healthStatus === PROVIDER_HEALTH_STATUS.DOWN)
          .length,
        unknownCount: rows.filter((r) => r.provider.healthStatus === PROVIDER_HEALTH_STATUS.UNKNOWN)
          .length,
        sampleCount,
        errorCount,
        errorRatePercent: sampleCount > 0 ? round2((errorCount / sampleCount) * 100) : null,
        avgLatencyMs: sampleCount > 0 ? round2(weightedLatencySum / sampleCount) : null,
      };
    });

    const totalObservations = providerRows.reduce((acc, r) => acc + r.telemetry.sampleCount, 0);
    const totalErrors = providerRows.reduce((acc, r) => acc + r.telemetry.errorCount, 0);
    const totalLatencyWeighted = providerRows.reduce(
      (acc, r) =>
        acc +
        (r.telemetry.avgLatencyMs !== null
          ? r.telemetry.avgLatencyMs * r.telemetry.sampleCount
          : 0),
      0,
    );

    const assignmentCount = query?.providerType
      ? assignments.filter((a) => a.providerType === query.providerType).length
      : assignments.length;

    return {
      windowMinutes,
      generatedAt: new Date().toISOString(),
      policy: {
        fallbackEnabled: runtimeConfig.fallbackEnabled,
        fallbackAllowedTypes: runtimeConfig.fallbackAllowedTypes,
        fallbackOnPaused: runtimeConfig.fallbackOnPaused,
        fallbackOnDown: runtimeConfig.fallbackOnDown,
        fallbackOnDegraded: runtimeConfig.fallbackOnDegraded,
        unitRoutingEnabled: runtimeConfig.unitRoutingEnabled,
      },
      thresholds: {
        healthCheckTimeoutMs: runtimeConfig.healthCheckTimeoutMs,
        degradedLatencyMs: runtimeConfig.degradedLatencyMs,
        degradedErrorRatePct: runtimeConfig.degradedErrorRatePct,
        downErrorRatePct: runtimeConfig.downErrorRatePct,
        consecutiveFailuresForDown: runtimeConfig.consecutiveFailuresForDown,
      },
      totals: {
        totalProviders: providerRows.length,
        activeCount: providerRows.filter((r) => r.provider.status === PROVIDER_STATUS.ACTIVE)
          .length,
        pausedCount: providerRows.filter((r) => r.provider.status === PROVIDER_STATUS.PAUSED)
          .length,
        disabledCount: providerRows.filter((r) => r.provider.status === PROVIDER_STATUS.DISABLED)
          .length,
        healthyCount: providerRows.filter(
          (r) => r.provider.healthStatus === PROVIDER_HEALTH_STATUS.HEALTHY,
        ).length,
        degradedCount: providerRows.filter(
          (r) => r.provider.healthStatus === PROVIDER_HEALTH_STATUS.DEGRADED,
        ).length,
        downCount: providerRows.filter(
          (r) => r.provider.healthStatus === PROVIDER_HEALTH_STATUS.DOWN,
        ).length,
        unknownCount: providerRows.filter(
          (r) => r.provider.healthStatus === PROVIDER_HEALTH_STATUS.UNKNOWN,
        ).length,
        unitAssignmentCount: assignmentCount,
        totalObservations,
        totalErrors,
        overallErrorRatePercent:
          totalObservations > 0 ? round2((totalErrors / totalObservations) * 100) : null,
        overallAvgLatencyMs:
          totalObservations > 0 ? round2(totalLatencyWeighted / totalObservations) : null,
      },
      byType,
      providers: providerRows,
    };
  }

  private aggregateBuckets(
    buckets: readonly ProviderMetricBucketEntity[],
  ): ProviderTelemetrySummaryView {
    if (buckets.length === 0) {
      return {
        available: false,
        sampleCount: 0,
        successCount: 0,
        errorCount: 0,
        errorRatePercent: null,
        avgLatencyMs: null,
        minLatencyMs: null,
        maxLatencyMs: null,
        p95LatencyMs: null,
        lastErrorCode: null,
        lastObservedAt: null,
      };
    }

    let sampleCount = 0;
    let successCount = 0;
    let errorCount = 0;
    let totalLatencyMs = 0;
    let minLatencyMs: number | null = null;
    let maxLatencyMs: number | null = null;
    let lastErrorCode: string | null = null;
    let lastObservedMs = 0;
    const allSamples: number[] = [];

    for (const bucket of buckets) {
      sampleCount += Number(bucket.totalCount ?? 0);
      successCount += Number(bucket.successCount ?? 0);
      errorCount += Number(bucket.errorCount ?? 0);
      totalLatencyMs += Number(bucket.totalLatencyMs ?? 0);

      if (bucket.minLatencyMs !== null && bucket.minLatencyMs !== undefined) {
        minLatencyMs =
          minLatencyMs === null ? bucket.minLatencyMs : Math.min(minLatencyMs, bucket.minLatencyMs);
      }
      if (bucket.maxLatencyMs !== null && bucket.maxLatencyMs !== undefined) {
        maxLatencyMs =
          maxLatencyMs === null ? bucket.maxLatencyMs : Math.max(maxLatencyMs, bucket.maxLatencyMs);
      }
      if (bucket.lastErrorCode) {
        lastErrorCode = bucket.lastErrorCode;
      }
      if (bucket.lastObservedAt) {
        const ms = new Date(bucket.lastObservedAt).getTime();
        if (Number.isFinite(ms) && ms > lastObservedMs) {
          lastObservedMs = ms;
        }
      }
      if (bucket.latencySamplesJson) {
        const samples = safeJsonParse<number[]>(bucket.latencySamplesJson, []) ?? [];
        for (const s of samples) {
          if (typeof s === 'number' && Number.isFinite(s)) {
            allSamples.push(s);
          }
        }
      }
    }

    if (sampleCount === 0) {
      return {
        available: false,
        sampleCount: 0,
        successCount: 0,
        errorCount: 0,
        errorRatePercent: null,
        avgLatencyMs: null,
        minLatencyMs: null,
        maxLatencyMs: null,
        p95LatencyMs: null,
        lastErrorCode: null,
        lastObservedAt: null,
      };
    }

    return {
      available: true,
      sampleCount,
      successCount,
      errorCount,
      errorRatePercent: round2((errorCount / sampleCount) * 100),
      avgLatencyMs: round2(totalLatencyMs / sampleCount),
      minLatencyMs,
      maxLatencyMs,
      p95LatencyMs: computeP95FromSamples(allSamples),
      lastErrorCode,
      lastObservedAt: lastObservedMs > 0 ? new Date(lastObservedMs).toISOString() : null,
    };
  }

  private async executeProbeForEntry(
    entry: ProviderRegistryEntryEntity,
    runtimeConfig: ProviderRegistryRuntimeConfig,
  ): Promise<ProviderHealthProbeResult> {
    const config = safeJsonParseObject<Record<string, unknown>>(entry.configJson, {});
    const probe = this.kernelRegistry.resolveHealthProbe(
      entry.providerType,
      entry.providerCode,
      entry.driverCode,
    );

    if (probe) {
      const started = performance.now();
      try {
        return await probe({
          providerId: Number(entry.id),
          providerCode: entry.providerCode,
          providerType: entry.providerType,
          driverCode: entry.driverCode,
          domainRefCode: entry.domainRefCode,
          secretRef: entry.secretRef,
          config,
          timeoutMs: runtimeConfig.healthCheckTimeoutMs,
        });
      } catch (err) {
        return {
          status: 'DOWN',
          latencyMs: Math.round(performance.now() - started),
          errorCode: 'HEALTH_PROBE_EXCEPTION',
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
    }

    if (typeof config.healthCheckUrl === 'string' && config.healthCheckUrl.trim()) {
      return this.executeHttpHealthProbe(entry, config.healthCheckUrl.trim(), runtimeConfig);
    }

    return this.executeBuiltInReadinessProbe(entry);
  }

  private async executeHttpHealthProbe(
    entry: ProviderRegistryEntryEntity,
    rawUrl: string,
    runtimeConfig: ProviderRegistryRuntimeConfig,
  ): Promise<ProviderHealthProbeResult> {
    const started = performance.now();
    let safeUrl: string;
    try {
      safeUrl = await validateHealthCheckUrl(rawUrl, {
        allowPrivateUrls: runtimeConfig.allowPrivateHealthUrls,
      });
    } catch (err) {
      return {
        status: 'DOWN',
        latencyMs: Math.round(performance.now() - started),
        errorCode: 'INVALID_HEALTH_CHECK_URL',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }

    if (!this.httpClient) {
      return {
        status: 'DEGRADED',
        latencyMs: Math.round(performance.now() - started),
        errorCode: 'HTTP_CLIENT_UNAVAILABLE',
        errorMessage: 'Outbound HTTP client is not available for health probe',
      };
    }

    try {
      const res = await this.httpClient.requestRaw<unknown>('GET', safeUrl, undefined, {
        service: entry.httpServiceName ?? 'provider-health-check',
        timeoutMs: runtimeConfig.healthCheckTimeoutMs,
        skipCircuitBreaker: true,
        retry: { maxRetries: 0 },
        responseType: 'void',
      });
      const latencyMs = Math.round(res.durationMs ?? performance.now() - started);
      return {
        status: 'HEALTHY',
        latencyMs,
        httpStatus: res.status,
        details: { url: safeUrl, httpStatus: res.status },
      };
    } catch (err) {
      const latencyMs = Math.round(performance.now() - started);
      if (err instanceof HttpStatusError) {
        const status = err.status ?? 500;
        return {
          status:
            status >= 500 || status === 404 || status === 401 || status === 403
              ? 'DOWN'
              : 'DEGRADED',
          latencyMs,
          httpStatus: status,
          errorCode: `HTTP_${status}`,
          errorMessage: err.message,
          details: { url: safeUrl, httpStatus: status },
        };
      }
      if (err instanceof HttpTimeoutError) {
        return {
          status: 'DOWN',
          latencyMs,
          errorCode: 'HTTP_TIMEOUT',
          errorMessage: err.message,
          details: { url: safeUrl },
        };
      }
      if (err instanceof HttpNetworkError) {
        return {
          status: 'DOWN',
          latencyMs,
          errorCode: 'HTTP_NETWORK_ERROR',
          errorMessage: err.message,
          details: { url: safeUrl },
        };
      }
      return {
        status: 'DOWN',
        latencyMs,
        errorCode: 'HTTP_PROBE_FAILED',
        errorMessage: err instanceof Error ? err.message : String(err),
        details: { url: safeUrl },
      };
    }
  }

  private async executeBuiltInReadinessProbe(
    entry: ProviderRegistryEntryEntity,
  ): Promise<ProviderHealthProbeResult> {
    const started = performance.now();
    if (entry.status === PROVIDER_STATUS.DISABLED) {
      return {
        status: 'DOWN',
        latencyMs: Math.round(performance.now() - started),
        errorCode: 'PROVIDER_DISABLED',
        errorMessage: `Provider "${entry.providerCode}" is disabled`,
      };
    }

    if (entry.secretRef && this.secretService) {
      const hasSecret = await this.secretService.hasSecret(entry.secretRef).catch(() => false);
      if (!hasSecret) {
        return {
          status: 'DEGRADED',
          latencyMs: Math.round(performance.now() - started),
          errorCode: 'SECRET_REF_MISSING',
          errorMessage: `Secret reference "${entry.secretRef}" is missing or empty`,
          details: { secretRef: entry.secretRef, secretConfigured: false },
        };
      }
    }

    return {
      status: 'HEALTHY',
      latencyMs: Math.round(performance.now() - started),
      details: {
        probeMode: 'built-in-readiness',
        secretConfigured: entry.secretRef ? true : Boolean(entry.secretsEncrypted),
      },
    };
  }

  private async resolveMatchingEntry(
    input: RecordProviderInvocationInput,
  ): Promise<ProviderRegistryEntryEntity | null> {
    const entries = await this.entryRepo.listAll();
    const candidates = entries.filter((e) => e.providerType === input.providerType);
    if (candidates.length === 0) return null;

    if (input.providerCode?.trim()) {
      const clean = input.providerCode.trim().toLowerCase();
      const matched =
        candidates.find((e) => e.providerCode === clean) ??
        candidates.find((e) => e.domainRefCode?.trim().toLowerCase() === clean);
      if (matched) return matched;
    }

    if (input.driverCode?.trim()) {
      const cleanDriver = input.driverCode.trim().toLowerCase();
      const matchedByDriver =
        candidates.find((e) => e.driverCode === cleanDriver && e.isPrimary) ??
        candidates.find((e) => e.driverCode === cleanDriver);
      if (matchedByDriver) return matchedByDriver;
    }

    return candidates.find((e) => e.isPrimary) ?? candidates[0] ?? null;
  }

  private mapProbeStatusToCode(
    status: ProviderHealthProbeResult['status'],
  ): ProviderHealthStatusCode {
    if (status === 'HEALTHY') return PROVIDER_HEALTH_STATUS.HEALTHY;
    if (status === 'DEGRADED') return PROVIDER_HEALTH_STATUS.DEGRADED;
    return PROVIDER_HEALTH_STATUS.DOWN;
  }
}

import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import { TransactionManager } from '@packages/database/index.js';
import { RequestTimeoutInterceptor } from '@packages/http/index.js';
import {
  CircuitBreakerRegistry,
  ConcurrencyLimiterRegistry,
  HttpClientLoggingInterceptor,
  HttpClientMetricsService,
  HttpServiceRegistry,
  RetryStormMonitor,
  type CircuitBreakerSnapshot,
  type ConcurrencyLimiterSnapshot,
  type HttpClientRecentError,
  type HttpServiceMetricsSnapshot,
  type RetryStormServiceSnapshot,
} from '@packages/http-client/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { RESILIENCE_SETTING_KEYS, readDynamicResilienceNumber } from '@packages/kernel/index.js';
import { QUEUE_PROFILES } from '@packages/messaging/index.js';
import {
  HttpClientActionRejectedException,
  HttpClientServiceNotFoundException,
} from '../exceptions/http-client-ops.exceptions.js';
import type {
  HttpClientAllCircuitsResetResultDto,
  HttpClientCircuitResetResultDto,
  HttpClientOpsConfigDto,
  HttpClientOpsHealthStatus,
  HttpClientOpsOverviewDto,
  HttpClientServiceOverviewDto,
  ResilienceLayersSummaryDto,
} from '../responses/http-client-ops.response.js';

/** Service tổng hợp giám sát và vận hành HTTP Client & Độ bền 4 tầng (`/ops/http-client/*`) */
@Injectable()
export class HttpClientOpsService {
  private readonly concurrencyLimiter: ConcurrencyLimiterRegistry;
  private readonly retryStorm: RetryStormMonitor;

  constructor(
    private readonly registry: HttpServiceRegistry,
    private readonly circuitBreaker: CircuitBreakerRegistry,
    private readonly metrics: HttpClientMetricsService,
    private readonly config: CoreConfigService,
    @Optional() private readonly i18n?: CoreI18nService,
    @Optional() concurrencyLimiter?: ConcurrencyLimiterRegistry,
    @Optional() retryStorm?: RetryStormMonitor,
    @Optional() private readonly requestTimeoutInterceptor?: RequestTimeoutInterceptor,
    @Optional() private readonly transactionManager?: TransactionManager,
  ) {
    this.concurrencyLimiter = concurrencyLimiter ?? new ConcurrencyLimiterRegistry();
    this.retryStorm = retryStorm ?? new RetryStormMonitor(config);
  }

  /** Lấy tổng quan trạng thái, thống kê lỗi/độ trễ, bulkhead, Retry Storm, 4 tầng resilience và dịch vụ outbound HTTP */
  public getOverview(): HttpClientOpsOverviewDto {
    const services = this.getServices();
    const totals = this.metrics.getTotals();
    const storm = this.retryStorm.getOverview();
    const openCircuits = services.filter((s) => s.circuit.state === 'OPEN').length;
    const halfOpenCircuits = services.filter((s) => s.circuit.state === 'HALF_OPEN').length;
    const hasCriticalStorm = storm.alerts.some((a) => a.severity === 'critical');
    const totalInFlight = services.reduce((sum, s) => sum + s.concurrency.inFlight, 0);

    let status: HttpClientOpsHealthStatus = 'healthy';
    if (openCircuits > 0 || hasCriticalStorm) {
      status = 'error';
    } else if (
      halfOpenCircuits > 0 ||
      storm.activeStormCount > 0 ||
      totals.concurrencyRejectedCount > 0 ||
      (totals.totalRequests > 0 && totals.errorRatePercent >= 5)
    ) {
      status = 'warning';
    } else if (totals.totalRequests === 0 && services.length === 0) {
      status = 'idle';
    }

    return {
      status,
      totals: {
        serviceCount: services.length,
        configuredServiceCount: this.registry.listServices().length,
        openCircuits,
        halfOpenCircuits,
        activeRetryStorms: storm.activeStormCount,
        totalInFlight,
        retriesInLastMin: storm.totalRetriesInLastMin,
        ...totals,
      },
      retryStorm: storm,
      resilience: this.getResilienceSummary(),
      services,
      recentErrors: this.metrics.getRecentErrors(20),
    };
  }

  /** Tổng hợp chính sách & metrics Retry / Timeout / Circuit Breaker / Bulkhead của cả 4 tầng (API, DB, Queue, Provider). */
  public getResilienceSummary(): ResilienceLayersSummaryDto {
    const apiStats = this.requestTimeoutInterceptor?.getStats();
    const apiTimeoutMs =
      apiStats?.effectiveDefaultTimeoutMs ??
      readDynamicResilienceNumber(
        RESILIENCE_SETTING_KEYS.API_REQUEST_TIMEOUT_MS,
        this.config.app.requestTimeoutMs,
        { min: 0, max: 600_000, round: true },
      );

    const dbCfg = this.config.database;
    const dbRetryCfg = this.transactionManager?.resolveRetryConfig() ?? dbCfg.retry;
    const dbStats = this.transactionManager?.getResilienceStats() ?? {
      timeoutCount: 0,
      retryCount: 0,
      retryRecoveredCount: 0,
      retryExhaustedCount: 0,
      lastTimeoutAt: null,
      lastRetryAt: null,
    };

    const msgCfg = this.config.messaging;
    const queueJitter = readDynamicResilienceNumber(
      RESILIENCE_SETTING_KEYS.QUEUE_RETRY_BACKOFF_JITTER,
      msgCfg.backoffJitter,
      { min: 0, max: 1 },
    );
    const queueStormPerMin = readDynamicResilienceNumber(
      RESILIENCE_SETTING_KEYS.QUEUE_RETRY_STORM_PER_MIN,
      this.config.queue.rules.retryStormPerMin,
      { min: 1, max: 100_000, round: true },
    );

    const httpDefault = this.registry.getDefaultPolicy();
    const httpTotals = this.metrics.getTotals();
    const storm = this.retryStorm.getOverview();

    return {
      api: {
        defaultTimeoutMs: apiTimeoutMs,
        connectionTimeoutMs: this.config.app.connectionTimeoutMs,
        keepAliveTimeoutMs: this.config.app.keepAliveTimeoutMs,
        totalTimeouts: apiStats?.totalTimeouts ?? 0,
        lastTimeoutAt: apiStats?.lastTimeoutAt ?? null,
        recentTimeouts: apiStats?.recentTimeouts ?? [],
      },
      database: {
        connectTimeoutMs: dbCfg.connectTimeoutMs,
        queryTimeoutMs: dbCfg.queryTimeoutMs,
        transactionTimeoutMs: dbCfg.transactionTimeoutMs,
        retryMax: dbRetryCfg.maxRetries,
        retryBaseDelayMs: dbRetryCfg.baseDelayMs,
        retryMaxDelayMs: dbRetryCfg.maxDelayMs,
        retryJitter: dbRetryCfg.jitter,
        timeoutCount: dbStats.timeoutCount,
        retryCount: dbStats.retryCount,
        retryRecoveredCount: dbStats.retryRecoveredCount,
        retryExhaustedCount: dbStats.retryExhaustedCount,
      },
      queue: {
        brokerTimeoutMs: msgCfg.timeoutMs,
        defaultExecutionTimeoutMs: msgCfg.executionTimeoutMs,
        maxAttempts: msgCfg.maxAttempts,
        maxAttemptsCap: msgCfg.maxAttemptsCap,
        backoffType: msgCfg.backoff,
        backoffDelayMs: msgCfg.backoffDelayMs,
        backoffJitter: queueJitter,
        retryStormPerMin: queueStormPerMin,
        profiles: Object.values(QUEUE_PROFILES).map((p) => ({
          queue: p.name,
          defaultTimeoutMs: p.defaultTimeoutMs,
          defaultAttempts: p.defaultAttempts,
          defaultBackoff: p.defaultBackoff,
          defaultBackoffDelayMs: p.defaultBackoffDelayMs,
          defaultConcurrency: p.defaultConcurrency,
        })),
      },
      provider: {
        defaultTimeoutMs: httpDefault.timeoutMs,
        maxRetries: httpDefault.retry.maxRetries,
        maxRetriesCap: httpDefault.retry.maxRetriesCap ?? 5,
        baseDelayMs: httpDefault.retry.baseDelayMs,
        maxDelayMs: httpDefault.retry.maxDelayMs,
        jitter: httpDefault.retry.jitter,
        circuitBreakerEnabled: httpDefault.circuitBreaker.enabled,
        concurrencyEnabled: httpDefault.concurrency.enabled,
        maxConcurrent: httpDefault.concurrency.maxConcurrent,
        maxQueue: httpDefault.concurrency.maxQueue,
        retryStormPerMin: storm.policy.retriesPerMinThreshold,
        retryStormRatioPercent: storm.policy.retryRatioPercent,
        retryStormSheddingEnabled: storm.policy.sheddingEnabled,
        activeRetryStorms: storm.activeStormCount,
        totalRequests: httpTotals.totalRequests,
        retryCount: httpTotals.retryCount,
        timeoutCount: httpTotals.timeoutCount,
        circuitRejectedCount: httpTotals.circuitRejectedCount,
        concurrencyRejectedCount: httpTotals.concurrencyRejectedCount,
        retryStormSheddedCount: httpTotals.retryStormSheddedCount,
      },
    };
  }

  /** Liệt kê cấu hình và chỉ số runtime của từng dịch vụ ngoài */
  public getServices(): HttpClientServiceOverviewDto[] {
    const configuredMap = new Map(this.registry.listServices().map((s) => [s.name, s]));
    const metricsMap = new Map(this.metrics.listServiceMetrics().map((m) => [m.service, m]));
    const circuitMap = new Map(this.circuitBreaker.listSnapshots().map((c) => [c.service, c]));
    const concurrencyMap = new Map(
      this.concurrencyLimiter.listSnapshots().map((b) => [b.service, b]),
    );
    const stormPolicy = this.retryStorm.resolvePolicy();

    const allNames = new Set<string>([
      ...configuredMap.keys(),
      ...metricsMap.keys(),
      ...circuitMap.keys(),
      ...concurrencyMap.keys(),
    ]);

    const rows: HttpClientServiceOverviewDto[] = [];
    for (const name of Array.from(allNames).sort()) {
      const configuredPolicy = configuredMap.get(name);
      const policy = configuredPolicy ?? this.registry.resolvePolicy(name);
      const metrics: HttpServiceMetricsSnapshot = metricsMap.get(name) ?? {
        service: name,
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        retryCount: 0,
        timeoutCount: 0,
        circuitRejectedCount: 0,
        concurrencyRejectedCount: 0,
        retryStormSheddedCount: 0,
        errorRatePercent: 0,
        avgDurationMs: 0,
        p95DurationMs: 0,
        lastRequestAt: null,
        lastStatus: null,
        lastError: null,
      };
      const circuit: CircuitBreakerSnapshot = circuitMap.get(name) ?? {
        service: name,
        state: 'CLOSED',
        consecutiveFailures: 0,
        failuresInWindow: 0,
        failureThreshold: policy.circuitBreaker.failureThreshold,
        failureWindowMs: policy.circuitBreaker.failureWindowMs,
        resetTimeoutMs: policy.circuitBreaker.resetTimeoutMs,
        openedAt: null,
        nextAttemptAt: null,
        lastFailureReason: null,
        halfOpenInFlight: 0,
        halfOpenSuccesses: 0,
        halfOpenSuccessThreshold: policy.circuitBreaker.halfOpenSuccessThreshold ?? 1,
        totalTrips: 0,
      };
      const concurrency: ConcurrencyLimiterSnapshot = concurrencyMap.get(name) ?? {
        service: name,
        enabled: policy.concurrency.enabled,
        inFlight: 0,
        maxConcurrent: policy.concurrency.maxConcurrent,
        queued: 0,
        maxQueue: policy.concurrency.maxQueue,
        peakInFlight: 0,
        totalRejected: 0,
      };
      const retryStorm: RetryStormServiceSnapshot = this.retryStorm.getServiceSnapshot(name) ?? {
        service: name,
        active: false,
        severity: null,
        retriesInLastMin: 0,
        requestsInLastMin: 0,
        retryRatioPercent: 0,
        retriesPerMinThreshold: stormPolicy.retriesPerMinThreshold,
        retryRatioThresholdPercent: stormPolicy.retryRatioPercent,
        sheddingActive: false,
        sheddedRetriesCount: 0,
        detectedAt: null,
        reason: null,
      };

      rows.push({
        service: name,
        configured: configuredPolicy !== undefined,
        policy,
        metrics,
        circuit,
        concurrency,
        retryStorm,
      });
    }
    return rows;
  }

  /** Lấy trạng thái các Circuit Breaker hiện đang được theo dõi */
  public getCircuits(): CircuitBreakerSnapshot[] {
    return this.circuitBreaker.listSnapshots();
  }

  /** Lấy danh sách các lỗi gọi dịch vụ ngoài gần đây (đã che dữ liệu nhạy cảm) */
  public getRecentErrors(limit = 20): HttpClientRecentError[] {
    return this.metrics.getRecentErrors(limit);
  }

  /** Trả về cấu hình HTTP Client hiện hành (đã hợp nhất Settings động + `.env` & che defaultHeaders nhạy cảm) */
  public getConfig(): HttpClientOpsConfigDto {
    const cfg = this.config.httpClient;
    const effective = this.registry.getDefaultPolicy();
    const stormPolicy = this.retryStorm.resolvePolicy();
    return {
      defaultTimeoutMs: effective.timeoutMs,
      retry: {
        maxRetries: effective.retry.maxRetries,
        maxRetriesCap: effective.retry.maxRetriesCap ?? cfg.retry.maxRetriesCap,
        baseDelayMs: effective.retry.baseDelayMs,
        maxDelayMs: effective.retry.maxDelayMs,
        jitter: effective.retry.jitter,
        respectRetryAfter: effective.retry.respectRetryAfter,
        retryNonIdempotent: effective.retry.retryNonIdempotent,
      },
      circuitBreaker: {
        enabled: effective.circuitBreaker.enabled,
        failureThreshold: effective.circuitBreaker.failureThreshold,
        failureWindowMs: effective.circuitBreaker.failureWindowMs,
        resetTimeoutMs: effective.circuitBreaker.resetTimeoutMs,
        halfOpenMaxProbes: effective.circuitBreaker.halfOpenMaxProbes,
        halfOpenSuccessThreshold:
          effective.circuitBreaker.halfOpenSuccessThreshold ??
          cfg.circuitBreaker.halfOpenSuccessThreshold,
      },
      concurrency: { ...effective.concurrency },
      retryStorm: { ...stormPolicy },
      logging: { ...cfg.logging },
      opsResetEnabled: cfg.opsResetEnabled,
      configuredServices: this.registry.listServices().map((svc) => ({
        name: svc.name,
        baseUrl: svc.baseUrl ? HttpClientLoggingInterceptor.sanitizeUrl(svc.baseUrl) : null,
        timeoutMs: svc.timeoutMs,
        maxRetries: svc.retry.maxRetries,
        circuitBreakerEnabled: svc.circuitBreaker.enabled,
        maxConcurrent: svc.concurrency.maxConcurrent,
        defaultHeaders: svc.defaultHeaders
          ? HttpClientLoggingInterceptor.sanitizeHeaders(svc.defaultHeaders)
          : {},
      })),
    };
  }

  /** Đóng lại Circuit Breaker của một dịch vụ cụ thể về trạng thái CLOSED */
  public resetCircuit(rawService: string): HttpClientCircuitResetResultDto {
    if (!this.config.httpClient.opsResetEnabled) {
      throw new HttpClientActionRejectedException();
    }

    const service = rawService.trim().toLowerCase();
    const existsInCircuit = this.circuitBreaker.getSnapshot(service) !== undefined;
    const existsInRegistry = this.registry.getService(service) !== undefined;
    const existsInMetrics = this.metrics.getServiceMetrics(service) !== undefined;

    if (!existsInCircuit && !existsInRegistry && !existsInMetrics) {
      throw new HttpClientServiceNotFoundException(service);
    }

    this.circuitBreaker.reset(service);
    this.metrics.recordCircuitState(service, 'CLOSED');

    return {
      service,
      reset: true,
      state: 'CLOSED',
      message: this.t(
        'ops.httpClient.resetCircuits.success',
        { count: 1 },
        'Reset 1 circuit breaker(s).',
      ),
    };
  }

  /** Đóng lại toàn bộ Circuit Breaker đang mở */
  public resetAllCircuits(): HttpClientAllCircuitsResetResultDto {
    if (!this.config.httpClient.opsResetEnabled) {
      throw new HttpClientActionRejectedException();
    }

    const snapshots = this.circuitBreaker.listSnapshots();
    const resetCount = this.circuitBreaker.resetAll();
    for (const s of snapshots) {
      this.metrics.recordCircuitState(s.service, 'CLOSED');
    }

    return {
      resetCount,
      message: this.t(
        'ops.httpClient.resetCircuits.success',
        { count: resetCount },
        `Reset ${resetCount} circuit breaker(s).`,
      ),
    };
  }

  private t(key: string, params: Record<string, string | number>, fallback: string): string {
    if (!this.i18n) return fallback;
    const msg = this.i18n.t(key, params);
    return msg === key ? fallback : msg;
  }
}

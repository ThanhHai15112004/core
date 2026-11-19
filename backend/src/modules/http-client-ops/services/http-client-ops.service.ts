import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  CircuitBreakerRegistry,
  HttpClientLoggingInterceptor,
  HttpClientMetricsService,
  HttpServiceRegistry,
  type CircuitBreakerSnapshot,
  type HttpClientRecentError,
  type HttpServiceMetricsSnapshot,
} from '@packages/http-client/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
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
} from '../responses/http-client-ops.response.js';

/** Service tổng hợp giám sát và vận hành HTTP Client dùng chung (`/ops/http-client/*`) */
@Injectable()
export class HttpClientOpsService {
  constructor(
    private readonly registry: HttpServiceRegistry,
    private readonly circuitBreaker: CircuitBreakerRegistry,
    private readonly metrics: HttpClientMetricsService,
    private readonly config: CoreConfigService,
    @Optional() private readonly i18n?: CoreI18nService,
  ) {}

  /** Lấy tổng quan trạng thái, thống kê lỗi/độ trễ và danh sách dịch vụ outbound HTTP */
  public getOverview(): HttpClientOpsOverviewDto {
    const services = this.getServices();
    const totals = this.metrics.getTotals();
    const openCircuits = services.filter((s) => s.circuit.state === 'OPEN').length;
    const halfOpenCircuits = services.filter((s) => s.circuit.state === 'HALF_OPEN').length;

    let status: HttpClientOpsHealthStatus = 'healthy';
    if (openCircuits > 0) {
      status = 'error';
    } else if (halfOpenCircuits > 0 || (totals.totalRequests > 0 && totals.errorRatePercent >= 5)) {
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
        ...totals,
      },
      services,
      recentErrors: this.metrics.getRecentErrors(20),
    };
  }

  /** Liệt kê cấu hình và chỉ số runtime của từng dịch vụ ngoài */
  public getServices(): HttpClientServiceOverviewDto[] {
    const configuredMap = new Map(this.registry.listServices().map((s) => [s.name, s]));
    const metricsMap = new Map(this.metrics.listServiceMetrics().map((m) => [m.service, m]));
    const circuitMap = new Map(this.circuitBreaker.listSnapshots().map((c) => [c.service, c]));

    const allNames = new Set<string>([
      ...configuredMap.keys(),
      ...metricsMap.keys(),
      ...circuitMap.keys(),
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
        totalTrips: 0,
      };
      rows.push({
        service: name,
        configured: configuredPolicy !== undefined,
        policy,
        metrics,
        circuit,
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

  /** Trả về cấu hình HTTP Client hiện hành (đã che defaultHeaders nhạy cảm) */
  public getConfig(): HttpClientOpsConfigDto {
    const cfg = this.config.httpClient;
    return {
      defaultTimeoutMs: cfg.defaultTimeoutMs,
      retry: { ...cfg.retry },
      circuitBreaker: { ...cfg.circuitBreaker },
      logging: { ...cfg.logging },
      opsResetEnabled: cfg.opsResetEnabled,
      configuredServices: this.registry.listServices().map((svc) => ({
        name: svc.name,
        baseUrl: svc.baseUrl ? HttpClientLoggingInterceptor.sanitizeUrl(svc.baseUrl) : null,
        timeoutMs: svc.timeoutMs,
        maxRetries: svc.retry.maxRetries,
        circuitBreakerEnabled: svc.circuitBreaker.enabled,
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

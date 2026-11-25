import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { MetricsRegistryService } from '@packages/metrics/index.js';
import type { Counter, Gauge, Histogram } from 'prom-client';
import type {
  CircuitBreakerState,
  HttpClientRecentError,
  HttpMethod,
  HttpRequestOutcome,
  HttpServiceMetricsSnapshot,
} from '../contracts/http-client.contract.js';
import { HttpClientLoggingInterceptor } from '../interceptors/http-client-logging.interceptor.js';

interface ServiceStatsAccumulator {
  totalRequests: number;
  successRequests: number;
  failedRequests: number;
  retryCount: number;
  timeoutCount: number;
  circuitRejectedCount: number;
  concurrencyRejectedCount: number;
  retryStormSheddedCount: number;
  durationSamples: number[];
  durationSumMs: number;
  lastRequestAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
}

const MAX_DURATION_SAMPLES = 200;
const MAX_RECENT_ERRORS = 50;

const CIRCUIT_STATE_VALUE: Record<CircuitBreakerState, number> = {
  CLOSED: 0,
  HALF_OPEN: 1,
  OPEN: 2,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function computeP95(samples: readonly number[]): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1));
  return round2(sorted[idx] ?? 0);
}

/**
 * Thu thập chỉ số thời gian phản hồi, tỷ lệ lỗi, số lần retry, timeout, bulkhead concurrency,
 * Retry Storm và trạng thái Circuit Breaker cho các outbound HTTP requests,
 * xuất ra Prometheus (`@packages/metrics`) và ảnh chụp in-memory.
 */
@Injectable()
export class HttpClientMetricsService {
  private readonly stats = new Map<string, ServiceStatsAccumulator>();
  private readonly recentErrors: HttpClientRecentError[] = [];

  private readonly durationHistogram: Histogram<'service' | 'method' | 'status' | 'outcome'> | null;
  private readonly requestsCounter: Counter<'service' | 'method' | 'status' | 'outcome'> | null;
  private readonly retriesCounter: Counter<'service' | 'method' | 'reason'> | null;
  private readonly timeoutsCounter: Counter<'service' | 'method'> | null;
  private readonly circuitGauge: Gauge<'service'> | null;
  private readonly inFlightGauge: Gauge<'service'> | null;
  private readonly concurrencyRejectedCounter: Counter<'service' | 'method'> | null;
  private readonly retryStormGauge: Gauge<'service'> | null;
  private readonly retryStormSheddedCounter: Counter<'service' | 'method'> | null;

  constructor(@Optional() metrics?: MetricsRegistryService) {
    if (metrics) {
      this.durationHistogram = metrics.histogram(
        'outbound_http_request_duration_seconds',
        'Outbound HTTP request duration in seconds',
        ['service', 'method', 'status', 'outcome'],
      );
      this.requestsCounter = metrics.counter(
        'outbound_http_requests_total',
        'Total outbound HTTP requests by service, method, status and outcome',
        ['service', 'method', 'status', 'outcome'],
      );
      this.retriesCounter = metrics.counter(
        'outbound_http_retries_total',
        'Total outbound HTTP retry attempts by service, method and reason',
        ['service', 'method', 'reason'],
      );
      this.timeoutsCounter = metrics.counter(
        'outbound_http_timeouts_total',
        'Total outbound HTTP request attempt timeouts by service and method',
        ['service', 'method'],
      );
      this.circuitGauge = metrics.gauge(
        'outbound_http_circuit_state',
        'Circuit breaker state per external service (0=CLOSED, 1=HALF_OPEN, 2=OPEN)',
        ['service'],
      );
      this.inFlightGauge = metrics.gauge(
        'outbound_http_in_flight_requests',
        'Current concurrent in-flight outbound HTTP requests per external service',
        ['service'],
      );
      this.concurrencyRejectedCounter = metrics.counter(
        'outbound_http_concurrency_rejected_total',
        'Total outbound HTTP requests rejected by per-service concurrency bulkhead limit',
        ['service', 'method'],
      );
      this.retryStormGauge = metrics.gauge(
        'outbound_http_retry_storm_active',
        'Whether a retry storm is currently active for an external service (0=normal, 1=storm)',
        ['service'],
      );
      this.retryStormSheddedCounter = metrics.counter(
        'outbound_http_retry_storm_shedded_total',
        'Total outbound HTTP retries suppressed by retry storm shedding budget',
        ['service', 'method'],
      );
    } else {
      this.durationHistogram = null;
      this.requestsCounter = null;
      this.retriesCounter = null;
      this.timeoutsCounter = null;
      this.circuitGauge = null;
      this.inFlightGauge = null;
      this.concurrencyRejectedCounter = null;
      this.retryStormGauge = null;
      this.retryStormSheddedCounter = null;
    }
  }

  /** Ghi nhận kết quả cuối cùng của một lượt gọi HTTP tới dịch vụ ngoài */
  public recordRequestOutcome(input: {
    service: string;
    method: HttpMethod;
    status: number | null;
    outcome: HttpRequestOutcome;
    durationMs: number;
    error?: {
      url: string;
      code: string;
      message: string;
      attempts: number;
      requestId: string | null;
      traceId: string | null;
    };
  }): void {
    const acc = this.getOrCreate(input.service);
    const nowIso = new Date().toISOString();

    acc.totalRequests += 1;
    acc.lastRequestAt = nowIso;
    acc.lastStatus = input.status;

    if (input.outcome === 'success') {
      acc.successRequests += 1;
    } else {
      acc.failedRequests += 1;
      if (input.outcome === 'timeout') acc.timeoutCount += 1;
      if (input.outcome === 'circuit_open') acc.circuitRejectedCount += 1;
      if (input.outcome === 'concurrency_rejected') {
        acc.concurrencyRejectedCount += 1;
        this.concurrencyRejectedCounter?.inc({ service: input.service, method: input.method });
      }
    }

    acc.durationSumMs += input.durationMs;
    acc.durationSamples.push(input.durationMs);
    if (acc.durationSamples.length > MAX_DURATION_SAMPLES) {
      acc.durationSamples.shift();
    }

    if (input.error) {
      const safeUrl = HttpClientLoggingInterceptor.sanitizeUrl(input.error.url);
      const safeMessage =
        HttpClientLoggingInterceptor.sanitizeSnippet(input.error.message, 300) ?? input.error.code;
      acc.lastError = safeMessage;
      this.recentErrors.unshift({
        id: randomUUID(),
        time: nowIso,
        service: input.service,
        method: input.method,
        url: safeUrl,
        status: input.status,
        code: input.error.code,
        message: safeMessage,
        durationMs: input.durationMs,
        attempts: input.error.attempts,
        requestId: input.error.requestId,
        traceId: input.error.traceId,
      });
      if (this.recentErrors.length > MAX_RECENT_ERRORS) {
        this.recentErrors.length = MAX_RECENT_ERRORS;
      }
    }

    const statusLabel = input.status !== null ? String(input.status) : 'none';
    this.requestsCounter?.inc({
      service: input.service,
      method: input.method,
      status: statusLabel,
      outcome: input.outcome,
    });
    this.durationHistogram?.observe(
      {
        service: input.service,
        method: input.method,
        status: statusLabel,
        outcome: input.outcome,
      },
      input.durationMs / 1000,
    );
  }

  /** Ghi nhận một lần thử lại (retry) do lỗi tạm thời */
  public recordRetry(service: string, method: HttpMethod, reason: string): void {
    const acc = this.getOrCreate(service);
    acc.retryCount += 1;
    this.retriesCounter?.inc({ service, method, reason });
  }

  /** Ghi nhận một lần attempt vượt quá timeout trên Prometheus */
  public recordTimeout(service: string, method: HttpMethod): void {
    this.timeoutsCounter?.inc({ service, method });
  }

  /** Cập nhật gauge trạng thái Circuit Breaker của dịch vụ lên Prometheus */
  public recordCircuitState(service: string, state: CircuitBreakerState): void {
    this.circuitGauge?.set({ service }, CIRCUIT_STATE_VALUE[state]);
  }

  /** Cập nhật số lượng request đang thực thi đồng thời (in-flight) lên Prometheus */
  public recordInFlight(service: string, count: number): void {
    this.inFlightGauge?.set({ service }, Math.max(0, count));
  }

  /** Cập nhật trạng thái Retry Storm đang hoạt động (0/1) lên Prometheus */
  public recordRetryStormState(service: string, active: boolean): void {
    this.retryStormGauge?.set({ service }, active ? 1 : 0);
  }

  /** Ghi nhận lượt retry bị tự động chặn do Retry Storm Shedding */
  public recordRetryStormShedded(service: string, method: HttpMethod): void {
    const acc = this.getOrCreate(service);
    acc.retryStormSheddedCount += 1;
    this.retryStormSheddedCounter?.inc({ service, method });
  }

  /** Lấy thống kê hiệu năng và tỷ lệ lỗi của một dịch vụ */
  public getServiceMetrics(service: string): HttpServiceMetricsSnapshot | undefined {
    const acc = this.stats.get(service);
    if (!acc) return undefined;
    return this.toSnapshot(service, acc);
  }

  /** Liệt kê thống kê của toàn bộ các dịch vụ đã phát sinh request */
  public listServiceMetrics(): HttpServiceMetricsSnapshot[] {
    const out: HttpServiceMetricsSnapshot[] = [];
    for (const [service, acc] of this.stats.entries()) {
      out.push(this.toSnapshot(service, acc));
    }
    return out;
  }

  /** Lấy danh sách lỗi gần nhất (đã che dữ liệu nhạy cảm) */
  public getRecentErrors(limit = 20, service?: string): HttpClientRecentError[] {
    const filtered = service
      ? this.recentErrors.filter((e) => e.service === service)
      : this.recentErrors;
    return filtered.slice(0, Math.max(1, limit));
  }

  /** Tổng hợp số liệu toàn cục trên tất cả dịch vụ ngoài */
  public getTotals(): {
    totalRequests: number;
    successRequests: number;
    failedRequests: number;
    retryCount: number;
    timeoutCount: number;
    circuitRejectedCount: number;
    concurrencyRejectedCount: number;
    retryStormSheddedCount: number;
    errorRatePercent: number;
    avgDurationMs: number;
    p95DurationMs: number;
  } {
    let totalRequests = 0;
    let successRequests = 0;
    let failedRequests = 0;
    let retryCount = 0;
    let timeoutCount = 0;
    let circuitRejectedCount = 0;
    let concurrencyRejectedCount = 0;
    let retryStormSheddedCount = 0;
    let durationSumMs = 0;
    const allSamples: number[] = [];

    for (const acc of this.stats.values()) {
      totalRequests += acc.totalRequests;
      successRequests += acc.successRequests;
      failedRequests += acc.failedRequests;
      retryCount += acc.retryCount;
      timeoutCount += acc.timeoutCount;
      circuitRejectedCount += acc.circuitRejectedCount;
      concurrencyRejectedCount += acc.concurrencyRejectedCount;
      retryStormSheddedCount += acc.retryStormSheddedCount;
      durationSumMs += acc.durationSumMs;
      allSamples.push(...acc.durationSamples);
    }

    return {
      totalRequests,
      successRequests,
      failedRequests,
      retryCount,
      timeoutCount,
      circuitRejectedCount,
      concurrencyRejectedCount,
      retryStormSheddedCount,
      errorRatePercent: totalRequests > 0 ? round2((failedRequests / totalRequests) * 100) : 0,
      avgDurationMs: totalRequests > 0 ? round2(durationSumMs / totalRequests) : 0,
      p95DurationMs: computeP95(allSamples),
    };
  }

  private getOrCreate(service: string): ServiceStatsAccumulator {
    let acc = this.stats.get(service);
    if (!acc) {
      acc = {
        totalRequests: 0,
        successRequests: 0,
        failedRequests: 0,
        retryCount: 0,
        timeoutCount: 0,
        circuitRejectedCount: 0,
        concurrencyRejectedCount: 0,
        retryStormSheddedCount: 0,
        durationSamples: [],
        durationSumMs: 0,
        lastRequestAt: null,
        lastStatus: null,
        lastError: null,
      };
      this.stats.set(service, acc);
    }
    return acc;
  }

  private toSnapshot(service: string, acc: ServiceStatsAccumulator): HttpServiceMetricsSnapshot {
    return {
      service,
      totalRequests: acc.totalRequests,
      successRequests: acc.successRequests,
      failedRequests: acc.failedRequests,
      retryCount: acc.retryCount,
      timeoutCount: acc.timeoutCount,
      circuitRejectedCount: acc.circuitRejectedCount,
      concurrencyRejectedCount: acc.concurrencyRejectedCount,
      retryStormSheddedCount: acc.retryStormSheddedCount,
      errorRatePercent:
        acc.totalRequests > 0 ? round2((acc.failedRequests / acc.totalRequests) * 100) : 0,
      avgDurationMs: acc.totalRequests > 0 ? round2(acc.durationSumMs / acc.totalRequests) : 0,
      p95DurationMs: computeP95(acc.durationSamples),
      lastRequestAt: acc.lastRequestAt,
      lastStatus: acc.lastStatus,
      lastError: acc.lastError,
    };
  }
}

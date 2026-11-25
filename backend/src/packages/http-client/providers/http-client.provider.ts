import { Injectable, Optional } from '@nestjs/common';
import {
  SpanKind,
  SpanStatusCode,
  context,
  isSpanContextValid,
  propagation,
  trace,
} from '@opentelemetry/api';
import { CoreConfigService } from '@packages/config/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { HttpServiceRegistry } from '../config/http-service-registry.js';
import type {
  HttpClientContract,
  HttpMethod,
  HttpRawResponse,
  HttpRequestOptions,
  HttpResponseType,
  ScopedHttpClientContract,
} from '../contracts/http-client.contract.js';
import {
  CircuitBreakerOpenError,
  HttpClientError,
  HttpConcurrencyLimitError,
  HttpNetworkError,
  HttpStatusError,
  HttpTimeoutError,
} from '../errors/http-client.errors.js';
import { HttpClientLoggingInterceptor } from '../interceptors/http-client-logging.interceptor.js';
import { HttpClientMetricsService } from '../monitoring/http-client-metrics.service.js';
import { CircuitBreakerRegistry } from '../resilience/circuit-breaker.registry.js';
import { ConcurrencyLimiterRegistry } from '../resilience/concurrency-limiter.registry.js';
import {
  computeBackoffDelayMs,
  parseRetryAfterMs,
  shouldRetryError,
  shouldRetryStatus,
  sleepWithAbort,
} from '../resilience/retry.policy.js';
import { RetryStormMonitor } from '../resilience/retry-storm.monitor.js';

function hasHeaderIgnoreCase(headers: Record<string, string>, targetName: string): boolean {
  const target = targetName.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === target);
}

function getHeaderIgnoreCase(
  headers: Record<string, string>,
  targetName: string,
): string | undefined {
  const target = targetName.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === target) return v;
  }
  return undefined;
}

type FetchBody = NonNullable<RequestInit['body']>;

function isRawFetchBody(body: unknown): body is FetchBody {
  return (
    typeof body === 'string' ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    body instanceof URLSearchParams ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream)
  );
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function isAbortTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'TimeoutError' ||
    err.name === 'AbortError' ||
    err.message.toLowerCase().includes('aborted due to timeout')
  );
}

function resolveServerAddress(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl).hostname || undefined;
  } catch {
    return undefined;
  }
}

/** Client HTTP dùng chung cho mọi lệnh gọi dịch vụ ngoài (timeout, retry, backoff+jitter, bulkhead, retry storm, trace ID, redact log, metrics, circuit breaker) */
@Injectable()
export class BaseHttpClientProvider implements HttpClientContract {
  private readonly registry: HttpServiceRegistry;
  private readonly circuitBreaker: CircuitBreakerRegistry;
  private readonly metrics: HttpClientMetricsService;
  private readonly concurrencyLimiter: ConcurrencyLimiterRegistry;
  private readonly retryStorm: RetryStormMonitor;
  private readonly logEnabled: boolean;
  private readonly maxErrorBodyLength: number;

  constructor(
    @Optional() registry?: HttpServiceRegistry,
    @Optional() circuitBreaker?: CircuitBreakerRegistry,
    @Optional() metrics?: HttpClientMetricsService,
    @Optional() config?: CoreConfigService,
    @Optional() concurrencyLimiter?: ConcurrencyLimiterRegistry,
    @Optional() retryStorm?: RetryStormMonitor,
  ) {
    this.registry = registry ?? new HttpServiceRegistry(config);
    this.circuitBreaker = circuitBreaker ?? new CircuitBreakerRegistry();
    this.metrics = metrics ?? new HttpClientMetricsService();
    this.concurrencyLimiter = concurrencyLimiter ?? new ConcurrencyLimiterRegistry();
    this.retryStorm = retryStorm ?? new RetryStormMonitor(config);
    this.logEnabled = config?.httpClient?.logging?.enabled ?? true;
    this.maxErrorBodyLength = config?.httpClient?.logging?.maxErrorBodyLength ?? 256;
  }

  /** Tạo client gắn sẵn tên dịch vụ để sử dụng thống nhất timeout/retry/circuit breaker theo dịch vụ */
  public forService(serviceName: string): ScopedHttpClientContract {
    const mergeOptions = (options?: HttpRequestOptions): HttpRequestOptions => ({
      ...options,
      service: serviceName,
    });
    return {
      get: <T>(url: string, options?: HttpRequestOptions) =>
        this.get<T>(url, mergeOptions(options)),
      post: <T, B = unknown>(url: string, body?: B, options?: HttpRequestOptions) =>
        this.post<T, B>(url, body, mergeOptions(options)),
      put: <T, B = unknown>(url: string, body?: B, options?: HttpRequestOptions) =>
        this.put<T, B>(url, body, mergeOptions(options)),
      patch: <T, B = unknown>(url: string, body?: B, options?: HttpRequestOptions) =>
        this.patch<T, B>(url, body, mergeOptions(options)),
      delete: <T>(url: string, options?: HttpRequestOptions) =>
        this.delete<T>(url, mergeOptions(options)),
      requestRaw: <T, B = unknown>(
        method: HttpMethod,
        url: string,
        body?: B,
        options?: HttpRequestOptions,
      ) => this.requestRaw<T, B>(method, url, body, mergeOptions(options)),
    };
  }

  /** Gửi yêu cầu HTTP GET tới dịch vụ bên ngoài */
  public async get<T>(url: string, options?: HttpRequestOptions): Promise<T> {
    const res = await this.requestRaw<T>('GET', url, undefined, options);
    return res.data;
  }

  /** Gửi yêu cầu HTTP POST tới dịch vụ bên ngoài */
  public async post<T, B = unknown>(
    url: string,
    body?: B,
    options?: HttpRequestOptions,
  ): Promise<T> {
    const res = await this.requestRaw<T, B>('POST', url, body, options);
    return res.data;
  }

  /** Gửi yêu cầu HTTP PUT tới dịch vụ bên ngoài */
  public async put<T, B = unknown>(
    url: string,
    body?: B,
    options?: HttpRequestOptions,
  ): Promise<T> {
    const res = await this.requestRaw<T, B>('PUT', url, body, options);
    return res.data;
  }

  /** Gửi yêu cầu HTTP PATCH tới dịch vụ bên ngoài */
  public async patch<T, B = unknown>(
    url: string,
    body?: B,
    options?: HttpRequestOptions,
  ): Promise<T> {
    const res = await this.requestRaw<T, B>('PATCH', url, body, options);
    return res.data;
  }

  /** Gửi yêu cầu HTTP DELETE tới dịch vụ bên ngoài */
  public async delete<T>(url: string, options?: HttpRequestOptions): Promise<T> {
    const res = await this.requestRaw<T>('DELETE', url, undefined, options);
    return res.data;
  }

  /**
   * Thực thi yêu cầu HTTP đầy đủ kèm timeout theo dịch vụ, retry lỗi tạm thời + backoff tăng dần,
   * truyền Request ID / Trace ID, che dữ liệu nhạy cảm trong log, ghi metrics và bảo vệ bằng Circuit Breaker.
   */
  public async requestRaw<T, B = unknown>(
    method: HttpMethod,
    rawUrl: string,
    body?: B,
    options?: HttpRequestOptions,
  ): Promise<HttpRawResponse<T>> {
    const service = this.registry.resolveServiceName(options?.service, rawUrl);
    const policy = this.registry.resolvePolicy(service, options);
    const fullUrl = this.registry.buildUrl(rawUrl, policy.baseUrl, options?.params);
    const redactedUrl = HttpClientLoggingInterceptor.sanitizeUrl(fullUrl);
    const serverAddress = resolveServerAddress(fullUrl);
    const tracer = trace.getTracer('core-framework');

    return tracer.startActiveSpan(
      `HTTP ${method} ${service}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'core.span.category': 'http',
          'peer.service': service,
          'http.request.method': method,
          'url.full': redactedUrl,
          ...(serverAddress ? { 'server.address': serverAddress } : {}),
        },
      },
      context.active(),
      async (span) => {
        const { headers, requestId, traceId } = this.buildOutboundHeaders(
          policy.defaultHeaders,
          body,
          options,
        );
        const hasIdempotencyKey =
          Boolean(options?.idempotencyKey) || hasHeaderIgnoreCase(headers, 'idempotency-key');

        this.retryStorm.recordRequest(service);

        if (!options?.skipCircuitBreaker) {
          try {
            const state = this.circuitBreaker.beforeRequest(
              service,
              policy.circuitBreaker,
              method,
              redactedUrl,
            );
            this.metrics.recordCircuitState(service, state);
          } catch (err) {
            if (err instanceof CircuitBreakerOpenError) {
              this.metrics.recordRequestOutcome({
                service,
                method,
                status: null,
                outcome: 'circuit_open',
                durationMs: 0,
                error: {
                  url: redactedUrl,
                  code: err.code,
                  message: err.message,
                  attempts: 0,
                  requestId,
                  traceId,
                },
              });
              HttpClientLoggingInterceptor.logError({
                service,
                method,
                url: redactedUrl,
                status: null,
                code: err.code,
                durationMs: 0,
                attempts: 0,
                message: err.message,
                requestId,
                traceId,
                enabled: this.logEnabled,
              });
            }
            span.setAttribute('http.outcome', 'circuit_open');
            span.recordException(err instanceof Error ? err : new Error(String(err)));
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: err instanceof Error ? err.message : String(err),
            });
            span.end();
            throw err;
          }
        }

        let releaseSlot: (() => void) | null = null;
        if (!options?.skipConcurrencyLimit && policy.concurrency.enabled) {
          try {
            const acquired = await this.concurrencyLimiter.acquire(
              service,
              policy.concurrency,
              method,
              redactedUrl,
              options?.signal,
            );
            releaseSlot = acquired.release;
            this.metrics.recordInFlight(service, acquired.inFlight);
          } catch (err) {
            if (!options?.skipCircuitBreaker) {
              // Giải phóng probe slot HALF_OPEN nếu đã chiếm trước khi bị bulkhead từ chối (không tính lỗi mạch)
              const state = this.circuitBreaker.onFailure(
                service,
                policy.circuitBreaker,
                err instanceof Error ? err.message : 'concurrency_limit',
                false,
              );
              this.metrics.recordCircuitState(service, state);
            }
            if (err instanceof HttpConcurrencyLimitError) {
              this.metrics.recordRequestOutcome({
                service,
                method,
                status: null,
                outcome: 'concurrency_rejected',
                durationMs: 0,
                error: {
                  url: redactedUrl,
                  code: err.code,
                  message: err.message,
                  attempts: 0,
                  requestId,
                  traceId,
                },
              });
              HttpClientLoggingInterceptor.logError({
                service,
                method,
                url: redactedUrl,
                status: null,
                code: err.code,
                durationMs: 0,
                attempts: 0,
                message: err.message,
                requestId,
                traceId,
                enabled: this.logEnabled,
              });
            }
            span.setAttribute('http.outcome', 'concurrency_rejected');
            span.recordException(err instanceof Error ? err : new Error(String(err)));
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: err instanceof Error ? err.message : String(err),
            });
            span.end();
            throw err;
          }
        }

        const totalStartMs = Date.now();
        const maxAttempts = 1 + Math.max(0, policy.retry.maxRetries);
        let lastError: HttpClientError | null = null;

        try {
          for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            const attemptStartMs = HttpClientLoggingInterceptor.logRequest({
              service,
              method,
              url: redactedUrl,
              attempt,
              requestId,
              traceId,
              enabled: this.logEnabled,
            });

            const timeoutSignal = AbortSignal.timeout(policy.timeoutMs);
            const signal = options?.signal
              ? AbortSignal.any([options.signal, timeoutSignal])
              : timeoutSignal;

            const init: RequestInit = {
              method,
              headers,
              signal,
              ...(options?.redirect ? { redirect: options.redirect } : {}),
            };
            if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
              const rawBody: unknown = body;
              init.body = isRawFetchBody(rawBody) ? rawBody : JSON.stringify(rawBody);
            }

            try {
              const res = await fetch(fullUrl, init);
              const attemptDurationMs = Date.now() - attemptStartMs;

              HttpClientLoggingInterceptor.logResponse({
                service,
                method,
                url: redactedUrl,
                status: res.status,
                durationMs: attemptDurationMs,
                attempt,
                requestId,
                traceId,
                enabled: this.logEnabled,
              });

              if (res.ok) {
                const parsed = await this.parseResponseBody<T>(
                  res,
                  options?.responseType ?? 'json',
                );
                const totalDurationMs = Date.now() - totalStartMs;
                if (!options?.skipCircuitBreaker) {
                  const state = this.circuitBreaker.onSuccess(service);
                  this.metrics.recordCircuitState(service, state);
                }
                const stormSnap = this.retryStorm.evaluateService(service);
                this.metrics.recordRetryStormState(service, stormSnap.active);
                this.metrics.recordRequestOutcome({
                  service,
                  method,
                  status: res.status,
                  outcome: 'success',
                  durationMs: totalDurationMs,
                });
                span.setAttributes({
                  'http.response.status_code': res.status,
                  'http.retry_count': attempt - 1,
                  'http.outcome': 'success',
                });
                span.setStatus({ code: SpanStatusCode.OK });
                span.end();
                return {
                  status: res.status,
                  headers: headersToRecord(res.headers),
                  data: parsed,
                  durationMs: totalDurationMs,
                  attempts: attempt,
                  service,
                  url: redactedUrl,
                };
              }

              const retryable = shouldRetryStatus(res.status, policy.retry);
              const retryAfterMs = parseRetryAfterMs(
                res.headers.get('retry-after'),
                policy.retry.maxDelayMs,
              );
              const rawText = await res.text().catch(() => '');
              const responseSnippet = HttpClientLoggingInterceptor.sanitizeSnippet(
                rawText,
                this.maxErrorBodyLength,
              );

              lastError = new HttpStatusError({
                service,
                method,
                url: redactedUrl,
                status: res.status,
                retryable,
                durationMs: Date.now() - totalStartMs,
                attempts: attempt,
                retryAfterMs,
                responseSnippet,
              });
            } catch (err) {
              const elapsedMs = Date.now() - totalStartMs;
              if (options?.signal?.aborted) {
                lastError = new HttpNetworkError({
                  service,
                  method,
                  url: redactedUrl,
                  detail: 'Request aborted by caller signal',
                  durationMs: elapsedMs,
                  attempts: attempt,
                  cause: err,
                });
                // Do not retry if caller explicitly cancelled their own AbortSignal
                break;
              }
              if (timeoutSignal.aborted || isAbortTimeoutError(err)) {
                this.metrics.recordTimeout(service, method);
                lastError = new HttpTimeoutError({
                  service,
                  method,
                  url: redactedUrl,
                  timeoutMs: policy.timeoutMs,
                  durationMs: elapsedMs,
                  attempts: attempt,
                  cause: err,
                });
              } else {
                const detail = err instanceof Error ? err.message : String(err);
                lastError = new HttpNetworkError({
                  service,
                  method,
                  url: redactedUrl,
                  detail,
                  durationMs: elapsedMs,
                  attempts: attempt,
                  cause: err,
                });
              }
            }

            if (
              attempt < maxAttempts &&
              shouldRetryError(lastError, method, hasIdempotencyKey, policy.retry)
            ) {
              const stormCheck = this.retryStorm.shouldShedRetry(service);
              this.metrics.recordRetryStormState(service, stormCheck.snapshot.active);
              if (stormCheck.shed) {
                this.metrics.recordRetryStormShedded(service, method);
                HttpClientLoggingInterceptor.logRetry({
                  service,
                  method,
                  url: redactedUrl,
                  attempt,
                  nextDelayMs: 0,
                  reason: `retry_storm_shedded(${stormCheck.snapshot.reason ?? 'active'})`,
                  requestId,
                  traceId,
                  enabled: this.logEnabled,
                });
                break;
              }

              const delayMs = computeBackoffDelayMs(attempt, policy.retry, lastError.retryAfterMs);
              const reason =
                lastError.status !== null ? `http_${lastError.status}` : lastError.code;
              const afterRetrySnap = this.retryStorm.recordRetry(service);
              this.metrics.recordRetryStormState(service, afterRetrySnap.active);
              this.metrics.recordRetry(service, method, reason);
              HttpClientLoggingInterceptor.logRetry({
                service,
                method,
                url: redactedUrl,
                attempt,
                nextDelayMs: delayMs,
                reason,
                requestId,
                traceId,
                enabled: this.logEnabled,
              });
              await sleepWithAbort(delayMs, options?.signal);
            } else {
              break;
            }
          }
        } finally {
          if (releaseSlot) {
            releaseSlot();
            this.metrics.recordInFlight(service, this.concurrencyLimiter.getInFlight(service));
          }
        }

        const finalError =
          lastError ??
          new HttpNetworkError({
            service,
            method,
            url: redactedUrl,
            detail: 'Unknown HTTP client failure',
            durationMs: Date.now() - totalStartMs,
            attempts: maxAttempts,
          });

        if (!options?.skipCircuitBreaker) {
          const nextState = this.circuitBreaker.onFailure(
            service,
            policy.circuitBreaker,
            finalError.message,
            finalError.countsTowardCircuit,
          );
          this.metrics.recordCircuitState(service, nextState);
        }

        const outcome =
          finalError instanceof HttpTimeoutError
            ? 'timeout'
            : finalError instanceof HttpStatusError
              ? 'http_error'
              : 'network_error';

        this.metrics.recordRequestOutcome({
          service,
          method,
          status: finalError.status,
          outcome,
          durationMs: finalError.durationMs,
          error: {
            url: redactedUrl,
            code: finalError.code,
            message: finalError.message,
            attempts: finalError.attempts,
            requestId,
            traceId,
          },
        });

        HttpClientLoggingInterceptor.logError({
          service,
          method,
          url: redactedUrl,
          status: finalError.status,
          code: finalError.code,
          durationMs: finalError.durationMs,
          attempts: finalError.attempts,
          message: finalError.message,
          requestId,
          traceId,
          enabled: this.logEnabled,
        });

        span.setAttributes({
          'http.outcome': outcome,
          'http.retry_count': Math.max(0, finalError.attempts - 1),
          ...(finalError.status !== null ? { 'http.response.status_code': finalError.status } : {}),
        });
        span.recordException(finalError);
        span.setStatus({ code: SpanStatusCode.ERROR, message: finalError.message });
        span.end();

        throw finalError;
      },
    );
  }

  private buildOutboundHeaders(
    serviceDefaultHeaders: Record<string, string> | undefined,
    body: unknown,
    options?: HttpRequestOptions,
  ): {
    headers: Record<string, string>;
    requestId: string | null;
    traceId: string | null;
  } {
    const headers: Record<string, string> = {
      ...(serviceDefaultHeaders ?? {}),
      ...(options?.headers ?? {}),
    };

    if (
      body !== undefined &&
      !isRawFetchBody(body) &&
      !hasHeaderIgnoreCase(headers, 'content-type')
    ) {
      headers['Content-Type'] = 'application/json';
    }

    if (options?.idempotencyKey && !hasHeaderIgnoreCase(headers, 'idempotency-key')) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }

    const ctx = RequestContextService.current();
    const activeSc = trace.getSpan(context.active())?.spanContext();
    const activeTraceId = activeSc && isSpanContextValid(activeSc) ? activeSc.traceId : null;

    if (!hasHeaderIgnoreCase(headers, 'traceparent')) {
      const carrier: Record<string, string> = {};
      propagation.inject(context.active(), carrier);
      if (carrier['traceparent']) headers['traceparent'] = carrier['traceparent'];
      if (carrier['tracestate'] && !hasHeaderIgnoreCase(headers, 'tracestate')) {
        headers['tracestate'] = carrier['tracestate'];
      }
    }

    const requestId =
      options?.requestId ??
      getHeaderIgnoreCase(headers, 'x-request-id') ??
      ctx?.requestId ??
      ctx?.correlationId ??
      null;
    const correlationId =
      getHeaderIgnoreCase(headers, 'x-correlation-id') ?? ctx?.correlationId ?? requestId;
    const ctxTraceId = typeof ctx?.['traceId'] === 'string' ? ctx['traceId'] : null;
    const traceId =
      options?.traceId ??
      getHeaderIgnoreCase(headers, 'x-trace-id') ??
      activeTraceId ??
      ctxTraceId ??
      correlationId;

    if (requestId && !hasHeaderIgnoreCase(headers, 'x-request-id')) {
      headers['x-request-id'] = requestId;
    }
    if (correlationId && !hasHeaderIgnoreCase(headers, 'x-correlation-id')) {
      headers['x-correlation-id'] = correlationId;
    }
    if (traceId && !hasHeaderIgnoreCase(headers, 'x-trace-id')) {
      headers['x-trace-id'] = traceId;
    }

    return { headers, requestId, traceId };
  }

  private async parseResponseBody<T>(res: Response, responseType: HttpResponseType): Promise<T> {
    if (responseType === 'void' || res.status === 204 || res.status === 205) {
      return undefined as T;
    }
    if (responseType === 'arrayBuffer') {
      return (await res.arrayBuffer()) as T;
    }
    if (responseType === 'text') {
      return (await res.text()) as T;
    }
    const text = await res.text();
    if (!text.trim()) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  }
}

export const HTTP_CLIENT_TOKEN = Symbol('HTTP_CLIENT_CONTRACT');

export const DEFAULT_RETRYABLE_STATUS_CODES = [408, 429, 502, 503, 504] as const;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type HttpResponseType = 'json' | 'text' | 'arrayBuffer' | 'void';

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export type HttpRequestOutcome =
  'success' | 'http_error' | 'timeout' | 'network_error' | 'circuit_open';

export interface HttpRetryPolicy {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly jitter: boolean;
  readonly retryableStatusCodes: readonly number[];
  readonly retryNonIdempotent: boolean;
  readonly respectRetryAfter: boolean;
}

export interface HttpCircuitBreakerPolicy {
  readonly enabled: boolean;
  readonly failureThreshold: number;
  readonly failureWindowMs: number;
  readonly resetTimeoutMs: number;
  readonly halfOpenMaxProbes: number;
}

export interface HttpServicePolicy {
  readonly name: string;
  readonly baseUrl?: string | undefined;
  readonly timeoutMs: number;
  readonly defaultHeaders?: Record<string, string> | undefined;
  readonly retry: HttpRetryPolicy;
  readonly circuitBreaker: HttpCircuitBreakerPolicy;
}

export interface HttpServicePolicyInput {
  readonly baseUrl?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly defaultHeaders?: Record<string, string> | undefined;
  readonly retry?: Partial<HttpRetryPolicy> | undefined;
  readonly circuitBreaker?: Partial<HttpCircuitBreakerPolicy> | undefined;
}

export interface HttpRequestOptions {
  readonly service?: string | undefined;
  readonly headers?: Record<string, string> | undefined;
  readonly params?: Record<string, string | number | boolean | undefined> | undefined;
  readonly timeoutMs?: number | undefined;
  readonly retry?: Partial<HttpRetryPolicy> | undefined;
  readonly skipCircuitBreaker?: boolean | undefined;
  readonly responseType?: HttpResponseType | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly requestId?: string | undefined;
  readonly traceId?: string | undefined;
}

export interface HttpRawResponse<T> {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly data: T;
  readonly durationMs: number;
  readonly attempts: number;
  readonly service: string;
  readonly url: string;
}

export interface ScopedHttpClientContract {
  get<T>(url: string, options?: HttpRequestOptions): Promise<T>;
  post<T, B = unknown>(url: string, body?: B, options?: HttpRequestOptions): Promise<T>;
  put<T, B = unknown>(url: string, body?: B, options?: HttpRequestOptions): Promise<T>;
  patch<T, B = unknown>(url: string, body?: B, options?: HttpRequestOptions): Promise<T>;
  delete<T>(url: string, options?: HttpRequestOptions): Promise<T>;
  requestRaw<T, B = unknown>(
    method: HttpMethod,
    url: string,
    body?: B,
    options?: HttpRequestOptions,
  ): Promise<HttpRawResponse<T>>;
}

export interface HttpClientContract extends ScopedHttpClientContract {
  forService(serviceName: string): ScopedHttpClientContract;
}

export interface CircuitBreakerSnapshot {
  readonly service: string;
  readonly state: CircuitBreakerState;
  readonly consecutiveFailures: number;
  readonly failuresInWindow: number;
  readonly failureThreshold: number;
  readonly failureWindowMs: number;
  readonly resetTimeoutMs: number;
  readonly openedAt: string | null;
  readonly nextAttemptAt: string | null;
  readonly lastFailureReason: string | null;
  readonly halfOpenInFlight: number;
  readonly totalTrips: number;
}

export interface HttpServiceMetricsSnapshot {
  readonly service: string;
  readonly totalRequests: number;
  readonly successRequests: number;
  readonly failedRequests: number;
  readonly retryCount: number;
  readonly timeoutCount: number;
  readonly circuitRejectedCount: number;
  readonly errorRatePercent: number;
  readonly avgDurationMs: number;
  readonly p95DurationMs: number;
  readonly lastRequestAt: string | null;
  readonly lastStatus: number | null;
  readonly lastError: string | null;
}

export interface HttpClientRecentError {
  readonly id: string;
  readonly time: string;
  readonly service: string;
  readonly method: HttpMethod;
  readonly url: string;
  readonly status: number | null;
  readonly code: string;
  readonly message: string;
  readonly durationMs: number;
  readonly attempts: number;
  readonly requestId: string | null;
  readonly traceId: string | null;
}

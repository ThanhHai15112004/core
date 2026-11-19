import type { HttpMethod } from '../contracts/http-client.contract.js';

export interface HttpClientErrorParams {
  readonly message: string;
  readonly code: string;
  readonly service: string;
  readonly method: HttpMethod;
  readonly url: string;
  readonly status: number | null;
  readonly retryable: boolean;
  readonly countsTowardCircuit: boolean;
  readonly durationMs: number;
  readonly attempts: number;
  readonly retryAfterMs?: number | null | undefined;
  readonly responseSnippet?: string | null | undefined;
  readonly cause?: unknown;
}

/** Lớp lỗi cơ sở cho mọi lỗi phát sinh khi gọi dịch vụ HTTP bên ngoài */
export class HttpClientError extends Error {
  public readonly code: string;
  public readonly service: string;
  public readonly method: HttpMethod;
  public readonly url: string;
  public readonly status: number | null;
  public readonly retryable: boolean;
  public readonly countsTowardCircuit: boolean;
  public readonly durationMs: number;
  public readonly attempts: number;
  public readonly retryAfterMs: number | null;
  public readonly responseSnippet: string | null;

  constructor(params: HttpClientErrorParams) {
    super(params.message, params.cause !== undefined ? { cause: params.cause } : undefined);
    this.name = new.target.name;
    this.code = params.code;
    this.service = params.service;
    this.method = params.method;
    this.url = params.url;
    this.status = params.status;
    this.retryable = params.retryable;
    this.countsTowardCircuit = params.countsTowardCircuit;
    this.durationMs = params.durationMs;
    this.attempts = params.attempts;
    this.retryAfterMs = params.retryAfterMs ?? null;
    this.responseSnippet = params.responseSnippet ?? null;
  }
}

/** Lỗi quá thời gian chờ phản hồi từ nhà cung cấp */
export class HttpTimeoutError extends HttpClientError {
  constructor(params: {
    service: string;
    method: HttpMethod;
    url: string;
    timeoutMs: number;
    durationMs: number;
    attempts: number;
    cause?: unknown;
  }) {
    super({
      message: `[HttpTimeoutError] ${params.method} ${params.url} (service=${params.service}) timed out after ${params.timeoutMs}ms`,
      code: 'HTTP_TIMEOUT',
      service: params.service,
      method: params.method,
      url: params.url,
      status: null,
      retryable: true,
      countsTowardCircuit: true,
      durationMs: params.durationMs,
      attempts: params.attempts,
      cause: params.cause,
    });
  }
}

/** Lỗi kết nối mạng hoặc DNS tới dịch vụ bên ngoài */
export class HttpNetworkError extends HttpClientError {
  constructor(params: {
    service: string;
    method: HttpMethod;
    url: string;
    detail: string;
    durationMs: number;
    attempts: number;
    cause?: unknown;
  }) {
    super({
      message: `[HttpNetworkError] ${params.method} ${params.url} (service=${params.service}) failed: ${params.detail}`,
      code: 'HTTP_NETWORK_ERROR',
      service: params.service,
      method: params.method,
      url: params.url,
      status: null,
      retryable: true,
      countsTowardCircuit: true,
      durationMs: params.durationMs,
      attempts: params.attempts,
      cause: params.cause,
    });
  }
}

/** Lỗi HTTP status từ phía nhà cung cấp (4xx nghiệp vụ hoặc 5xx/429 tạm thời) */
export class HttpStatusError extends HttpClientError {
  constructor(params: {
    service: string;
    method: HttpMethod;
    url: string;
    status: number;
    retryable: boolean;
    durationMs: number;
    attempts: number;
    retryAfterMs?: number | null | undefined;
    responseSnippet?: string | null | undefined;
  }) {
    super({
      message: `[HttpStatusError] ${params.method} ${params.url} (service=${params.service}) responded with HTTP ${params.status}`,
      code: 'HTTP_STATUS_ERROR',
      service: params.service,
      method: params.method,
      url: params.url,
      status: params.status,
      retryable: params.retryable,
      countsTowardCircuit: params.status >= 500 || params.status === 429 || params.status === 408,
      durationMs: params.durationMs,
      attempts: params.attempts,
      retryAfterMs: params.retryAfterMs ?? null,
      responseSnippet: params.responseSnippet ?? null,
    });
  }
}

/** Lỗi từ chối gọi nhanh khi Circuit Breaker của dịch vụ đang ở trạng thái OPEN */
export class CircuitBreakerOpenError extends HttpClientError {
  public readonly nextAttemptAt: string | null;

  constructor(params: {
    service: string;
    method: HttpMethod;
    url: string;
    nextAttemptAt: string | null;
  }) {
    super({
      message: `[CircuitBreakerOpenError] Circuit for service "${params.service}" is OPEN (nextAttemptAt=${params.nextAttemptAt ?? 'unknown'})`,
      code: 'HTTP_CIRCUIT_OPEN',
      service: params.service,
      method: params.method,
      url: params.url,
      status: null,
      retryable: false,
      countsTowardCircuit: false,
      durationMs: 0,
      attempts: 0,
    });
    this.nextAttemptAt = params.nextAttemptAt;
  }
}

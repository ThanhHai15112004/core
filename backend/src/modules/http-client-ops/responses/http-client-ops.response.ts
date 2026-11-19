import type {
  CircuitBreakerSnapshot,
  HttpClientRecentError,
  HttpServiceMetricsSnapshot,
  HttpServicePolicy,
} from '@packages/http-client/index.js';

export type HttpClientOpsHealthStatus = 'healthy' | 'warning' | 'error' | 'idle';

export interface HttpClientServiceOverviewDto {
  readonly service: string;
  readonly configured: boolean;
  readonly policy: HttpServicePolicy;
  readonly metrics: HttpServiceMetricsSnapshot;
  readonly circuit: CircuitBreakerSnapshot;
}

export interface HttpClientOpsOverviewDto {
  readonly status: HttpClientOpsHealthStatus;
  readonly totals: {
    readonly serviceCount: number;
    readonly configuredServiceCount: number;
    readonly openCircuits: number;
    readonly halfOpenCircuits: number;
    readonly totalRequests: number;
    readonly successRequests: number;
    readonly failedRequests: number;
    readonly retryCount: number;
    readonly timeoutCount: number;
    readonly circuitRejectedCount: number;
    readonly errorRatePercent: number;
    readonly avgDurationMs: number;
    readonly p95DurationMs: number;
  };
  readonly services: HttpClientServiceOverviewDto[];
  readonly recentErrors: HttpClientRecentError[];
}

export interface HttpClientOpsConfigDto {
  readonly defaultTimeoutMs: number;
  readonly retry: {
    readonly maxRetries: number;
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
    readonly jitter: boolean;
    readonly respectRetryAfter: boolean;
    readonly retryNonIdempotent: boolean;
  };
  readonly circuitBreaker: {
    readonly enabled: boolean;
    readonly failureThreshold: number;
    readonly failureWindowMs: number;
    readonly resetTimeoutMs: number;
    readonly halfOpenMaxProbes: number;
  };
  readonly logging: {
    readonly enabled: boolean;
    readonly maxErrorBodyLength: number;
  };
  readonly opsResetEnabled: boolean;
  readonly configuredServices: Array<{
    readonly name: string;
    readonly baseUrl: string | null;
    readonly timeoutMs: number;
    readonly maxRetries: number;
    readonly circuitBreakerEnabled: boolean;
    readonly defaultHeaders: Record<string, string>;
  }>;
}

export interface HttpClientCircuitResetResultDto {
  readonly service: string;
  readonly reset: boolean;
  readonly state: 'CLOSED';
  readonly message: string;
}

export interface HttpClientAllCircuitsResetResultDto {
  readonly resetCount: number;
  readonly message: string;
}

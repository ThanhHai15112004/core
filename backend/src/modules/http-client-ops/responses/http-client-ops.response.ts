import type {
  CircuitBreakerSnapshot,
  ConcurrencyLimiterSnapshot,
  HttpClientRecentError,
  HttpServiceMetricsSnapshot,
  HttpServicePolicy,
  RetryStormOverviewSnapshot,
  RetryStormServiceSnapshot,
} from '@packages/http-client/index.js';
import type { ApiTimeoutRecord } from '@packages/http/index.js';

export type HttpClientOpsHealthStatus = 'healthy' | 'warning' | 'error' | 'idle';

export interface HttpClientServiceOverviewDto {
  readonly service: string;
  readonly configured: boolean;
  readonly policy: HttpServicePolicy;
  readonly metrics: HttpServiceMetricsSnapshot;
  readonly circuit: CircuitBreakerSnapshot;
  readonly concurrency: ConcurrencyLimiterSnapshot;
  readonly retryStorm: RetryStormServiceSnapshot;
}

export interface ResilienceQueueProfileDto {
  readonly queue: string;
  readonly defaultTimeoutMs: number;
  readonly defaultAttempts: number;
  readonly defaultBackoff: string;
  readonly defaultBackoffDelayMs: number;
  readonly defaultConcurrency: number;
}

export interface ResilienceLayersSummaryDto {
  readonly api: {
    readonly defaultTimeoutMs: number;
    readonly connectionTimeoutMs: number;
    readonly keepAliveTimeoutMs: number;
    readonly totalTimeouts: number;
    readonly lastTimeoutAt: string | null;
    readonly recentTimeouts: readonly ApiTimeoutRecord[];
  };
  readonly database: {
    readonly connectTimeoutMs: number;
    readonly queryTimeoutMs: number;
    readonly transactionTimeoutMs: number;
    readonly retryMax: number;
    readonly retryBaseDelayMs: number;
    readonly retryMaxDelayMs: number;
    readonly retryJitter: boolean;
    readonly timeoutCount: number;
    readonly retryCount: number;
    readonly retryRecoveredCount: number;
    readonly retryExhaustedCount: number;
  };
  readonly queue: {
    readonly brokerTimeoutMs: number;
    readonly defaultExecutionTimeoutMs: number;
    readonly maxAttempts: number;
    readonly maxAttemptsCap: number;
    readonly backoffType: string;
    readonly backoffDelayMs: number;
    readonly backoffJitter: number;
    readonly retryStormPerMin: number;
    readonly profiles: readonly ResilienceQueueProfileDto[];
  };
  readonly provider: {
    readonly defaultTimeoutMs: number;
    readonly maxRetries: number;
    readonly maxRetriesCap: number;
    readonly baseDelayMs: number;
    readonly maxDelayMs: number;
    readonly jitter: boolean;
    readonly circuitBreakerEnabled: boolean;
    readonly concurrencyEnabled: boolean;
    readonly maxConcurrent: number;
    readonly maxQueue: number;
    readonly retryStormPerMin: number;
    readonly retryStormRatioPercent: number;
    readonly retryStormSheddingEnabled: boolean;
    readonly activeRetryStorms: number;
    readonly totalRequests: number;
    readonly retryCount: number;
    readonly timeoutCount: number;
    readonly circuitRejectedCount: number;
    readonly concurrencyRejectedCount: number;
    readonly retryStormSheddedCount: number;
  };
}

export interface HttpClientOpsOverviewDto {
  readonly status: HttpClientOpsHealthStatus;
  readonly totals: {
    readonly serviceCount: number;
    readonly configuredServiceCount: number;
    readonly openCircuits: number;
    readonly halfOpenCircuits: number;
    readonly activeRetryStorms: number;
    readonly totalInFlight: number;
    readonly retriesInLastMin: number;
    readonly totalRequests: number;
    readonly successRequests: number;
    readonly failedRequests: number;
    readonly retryCount: number;
    readonly timeoutCount: number;
    readonly circuitRejectedCount: number;
    readonly concurrencyRejectedCount: number;
    readonly retryStormSheddedCount: number;
    readonly errorRatePercent: number;
    readonly avgDurationMs: number;
    readonly p95DurationMs: number;
  };
  readonly retryStorm: RetryStormOverviewSnapshot;
  readonly resilience: ResilienceLayersSummaryDto;
  readonly services: HttpClientServiceOverviewDto[];
  readonly recentErrors: HttpClientRecentError[];
}

export interface HttpClientOpsConfigDto {
  readonly defaultTimeoutMs: number;
  readonly retry: {
    readonly maxRetries: number;
    readonly maxRetriesCap: number;
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
    readonly halfOpenSuccessThreshold: number;
  };
  readonly concurrency: {
    readonly enabled: boolean;
    readonly maxConcurrent: number;
    readonly maxQueue: number;
    readonly queueTimeoutMs: number;
  };
  readonly retryStorm: {
    readonly retriesPerMinThreshold: number;
    readonly retryRatioPercent: number;
    readonly minRequests: number;
    readonly sheddingEnabled: boolean;
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
    readonly maxConcurrent: number;
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

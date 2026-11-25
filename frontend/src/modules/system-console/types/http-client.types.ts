export type HttpClientOpsHealthStatus = 'healthy' | 'warning' | 'error' | 'idle';
export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export type RetryStormSeverity = 'warning' | 'critical';

export interface ConcurrencyLimiterSnapshotDto {
  service: string;
  enabled: boolean;
  inFlight: number;
  maxConcurrent: number;
  queued: number;
  maxQueue: number;
  peakInFlight: number;
  totalRejected: number;
}

export interface RetryStormServiceSnapshotDto {
  service: string;
  active: boolean;
  severity: RetryStormSeverity | null;
  retriesInLastMin: number;
  requestsInLastMin: number;
  retryRatioPercent: number;
  retriesPerMinThreshold: number;
  retryRatioThresholdPercent: number;
  sheddingActive: boolean;
  sheddedRetriesCount: number;
  detectedAt: string | null;
  reason: string | null;
}

export interface RetryStormOverviewDto {
  activeStormCount: number;
  totalRetriesInLastMin: number;
  totalSheddedRetries: number;
  policy: {
    retriesPerMinThreshold: number;
    retryRatioPercent: number;
    minRequests: number;
    sheddingEnabled: boolean;
  };
  alerts: RetryStormServiceSnapshotDto[];
}

export interface ResilienceLayersSummaryDto {
  api: {
    defaultTimeoutMs: number;
    connectionTimeoutMs: number;
    keepAliveTimeoutMs: number;
    totalTimeouts: number;
    lastTimeoutAt: string | null;
    recentTimeouts: Array<{
      method: string;
      route: string;
      timeoutMs: number;
      at: string;
    }>;
  };
  database: {
    connectTimeoutMs: number;
    queryTimeoutMs: number;
    transactionTimeoutMs: number;
    retryMax: number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
    retryJitter: boolean;
    timeoutCount: number;
    retryCount: number;
    retryRecoveredCount: number;
    retryExhaustedCount: number;
  };
  queue: {
    brokerTimeoutMs: number;
    defaultExecutionTimeoutMs: number;
    maxAttempts: number;
    maxAttemptsCap: number;
    backoffType: string;
    backoffDelayMs: number;
    backoffJitter: number;
    retryStormPerMin: number;
    profiles: Array<{
      queue: string;
      defaultTimeoutMs: number;
      defaultAttempts: number;
      defaultBackoff: string;
      defaultBackoffDelayMs: number;
      defaultConcurrency: number;
    }>;
  };
  provider: {
    defaultTimeoutMs: number;
    maxRetries: number;
    maxRetriesCap: number;
    baseDelayMs: number;
    maxDelayMs: number;
    jitter: boolean;
    circuitBreakerEnabled: boolean;
    concurrencyEnabled: boolean;
    maxConcurrent: number;
    maxQueue: number;
    retryStormPerMin: number;
    retryStormRatioPercent: number;
    retryStormSheddingEnabled: boolean;
    activeRetryStorms: number;
    totalRequests: number;
    retryCount: number;
    timeoutCount: number;
    circuitRejectedCount: number;
    concurrencyRejectedCount: number;
    retryStormSheddedCount: number;
  };
}

export interface HttpClientServiceOverviewDto {
  service: string;
  configured: boolean;
  policy: {
    name: string;
    baseUrl?: string;
    timeoutMs: number;
    retry: {
      maxRetries: number;
      maxRetriesCap?: number;
      baseDelayMs: number;
      maxDelayMs: number;
      jitter: boolean;
      retryableStatusCodes: number[];
      retryNonIdempotent: boolean;
      respectRetryAfter: boolean;
    };
    circuitBreaker: {
      enabled: boolean;
      failureThreshold: number;
      failureWindowMs: number;
      resetTimeoutMs: number;
      halfOpenMaxProbes: number;
      halfOpenSuccessThreshold?: number;
    };
    concurrency?: {
      enabled: boolean;
      maxConcurrent: number;
      maxQueue: number;
      queueTimeoutMs: number;
    };
  };
  metrics: {
    service: string;
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
    lastRequestAt: string | null;
    lastStatus: number | null;
    lastError: string | null;
  };
  circuit: {
    service: string;
    state: CircuitBreakerState;
    consecutiveFailures: number;
    failuresInWindow: number;
    failureThreshold: number;
    failureWindowMs: number;
    resetTimeoutMs: number;
    openedAt: string | null;
    nextAttemptAt: string | null;
    lastFailureReason: string | null;
    halfOpenInFlight: number;
    halfOpenSuccesses?: number;
    halfOpenSuccessThreshold?: number;
    totalTrips: number;
  };
  concurrency: ConcurrencyLimiterSnapshotDto;
  retryStorm: RetryStormServiceSnapshotDto;
}

export interface HttpClientRecentErrorDto {
  id: string;
  time: string;
  service: string;
  method: string;
  url: string;
  status: number | null;
  code: string;
  message: string;
  durationMs: number;
  attempts: number;
  requestId: string | null;
  traceId: string | null;
}

export interface HttpClientOpsOverviewDto {
  status: HttpClientOpsHealthStatus;
  totals: {
    serviceCount: number;
    configuredServiceCount: number;
    openCircuits: number;
    halfOpenCircuits: number;
    activeRetryStorms: number;
    totalInFlight: number;
    retriesInLastMin: number;
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
  };
  retryStorm: RetryStormOverviewDto;
  resilience: ResilienceLayersSummaryDto;
  services: HttpClientServiceOverviewDto[];
  recentErrors: HttpClientRecentErrorDto[];
}

export interface HttpClientCircuitResetResultDto {
  service: string;
  reset: boolean;
  state: 'CLOSED';
  message: string;
}

export interface HttpClientAllCircuitsResetResultDto {
  resetCount: number;
  message: string;
}

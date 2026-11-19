export type HttpClientOpsHealthStatus = 'healthy' | 'warning' | 'error' | 'idle';
export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface HttpClientServiceOverviewDto {
  service: string;
  configured: boolean;
  policy: {
    name: string;
    baseUrl?: string;
    timeoutMs: number;
    retry: {
      maxRetries: number;
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
    totalTrips: number;
  };
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
    totalRequests: number;
    successRequests: number;
    failedRequests: number;
    retryCount: number;
    timeoutCount: number;
    circuitRejectedCount: number;
    errorRatePercent: number;
    avgDurationMs: number;
    p95DurationMs: number;
  };
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

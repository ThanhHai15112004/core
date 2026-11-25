export const ALERT_METRIC_KEY = {
  HTTP_REQUEST_RATE: 'http.request_rate',
  HTTP_ERROR_RATE: 'http.error_rate',
  HTTP_LATENCY_P50: 'http.latency_p50',
  HTTP_LATENCY_P95: 'http.latency_p95',
  HTTP_LATENCY_P99: 'http.latency_p99',
  RUNTIME_CPU_PERCENT: 'runtime.cpu_percent',
  RUNTIME_MEMORY_PERCENT: 'runtime.memory_percent',
  RUNTIME_EVENT_LOOP_P99_MS: 'runtime.event_loop_p99_ms',
  DB_POOL_UTILIZATION_PERCENT: 'db.pool_utilization_percent',
  DB_POOL_WAITING: 'db.pool_waiting',
  QUEUE_BACKLOG: 'queue.backlog',
  QUEUE_OLDEST_JOB_AGE_SEC: 'queue.oldest_job_age_sec',
  REDIS_LATENCY_P95_MS: 'redis.latency_p95_ms',
  PROVIDER_LATENCY_P95_MS: 'provider.latency_p95_ms',
} as const;

export type AlertMetricKey = (typeof ALERT_METRIC_KEY)[keyof typeof ALERT_METRIC_KEY];

export const ALL_ALERT_METRIC_KEYS = Object.values(ALERT_METRIC_KEY) as readonly AlertMetricKey[];

export const ALERT_OPERATOR = {
  GT: 'gt',
  GTE: 'gte',
  LT: 'lt',
  LTE: 'lte',
} as const;

export type AlertOperator = (typeof ALERT_OPERATOR)[keyof typeof ALERT_OPERATOR];

export const ALL_ALERT_OPERATORS = Object.values(ALERT_OPERATOR) as readonly AlertOperator[];

export const ALERT_SEVERITY = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  CRITICAL: 'CRITICAL',
} as const;

export type AlertSeverity = (typeof ALERT_SEVERITY)[keyof typeof ALERT_SEVERITY];

export const ALL_ALERT_SEVERITIES = Object.values(ALERT_SEVERITY) as readonly AlertSeverity[];

export const ALERT_EVENT_STATUS = {
  FIRING: 'FIRING',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESOLVED: 'RESOLVED',
} as const;

export type AlertEventStatus = (typeof ALERT_EVENT_STATUS)[keyof typeof ALERT_EVENT_STATUS];

export const ALL_ALERT_EVENT_STATUSES = Object.values(
  ALERT_EVENT_STATUS,
) as readonly AlertEventStatus[];

export const ALERT_CHANNEL = {
  LOG: 'log',
  WEBHOOK: 'webhook',
  NOTIFICATION: 'notification',
  DOMAIN_EVENT: 'domain_event',
} as const;

export type AlertChannel = (typeof ALERT_CHANNEL)[keyof typeof ALERT_CHANNEL];

export const ALL_ALERT_CHANNELS = Object.values(ALERT_CHANNEL) as readonly AlertChannel[];

export const METRICS_OPS_EVENTS = {
  ALERT_FIRED: 'metrics.alert.fired',
  ALERT_RESOLVED: 'metrics.alert.resolved',
} as const;

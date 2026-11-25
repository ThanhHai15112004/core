import type { TimeRange } from '@core/constants/ui.constants';
import type { Tone } from '@core/theme';

export type MetricsAlertsRange = Extract<TimeRange, '5m' | '15m' | '1h' | '6h' | '24h'>;

export const METRICS_ALERTS_TABS = ['metrics', 'rules', 'events'] as const;
export type MetricsAlertsTab = (typeof METRICS_ALERTS_TABS)[number];

export const METRICS_ALERTS_RANGES = ['5m', '15m', '1h', '6h', '24h'] as const satisfies readonly MetricsAlertsRange[];

export const ALERT_METRIC_KEYS = [
  'http.request_rate',
  'http.error_rate',
  'http.latency_p50',
  'http.latency_p95',
  'http.latency_p99',
  'runtime.cpu_percent',
  'runtime.memory_percent',
  'runtime.event_loop_p99_ms',
  'db.pool_utilization_percent',
  'db.pool_waiting',
  'queue.backlog',
  'queue.oldest_job_age_sec',
  'redis.latency_p95_ms',
  'provider.latency_p95_ms',
] as const;

export const ALERT_OPERATORS = ['gt', 'gte', 'lt', 'lte'] as const;
export const ALERT_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export const ALERT_EVENT_STATUSES = ['FIRING', 'ACKNOWLEDGED', 'RESOLVED'] as const;

export const SEVERITY_TONE_MAP: Record<(typeof ALERT_SEVERITIES)[number], Tone> = {
  INFO: 'info',
  WARNING: 'warn',
  CRITICAL: 'crit',
};

export const EVENT_STATUS_TONE_MAP: Record<(typeof ALERT_EVENT_STATUSES)[number], Tone> = {
  FIRING: 'crit',
  ACKNOWLEDGED: 'warn',
  RESOLVED: 'ok',
};

export type AlertSeverityDto = 'INFO' | 'WARNING' | 'CRITICAL';
export type AlertOperatorDto = 'gt' | 'gte' | 'lt' | 'lte';
export type AlertEventStatusDto = 'FIRING' | 'ACKNOWLEDGED' | 'RESOLVED';
export type AlertChannelDto = 'log' | 'webhook' | 'notification' | 'domain_event';

export interface HttpApiMetricDto {
  method: string;
  route: string;
  module: string;
  requests: number;
  rps: number;
  errors4xx: number;
  errors5xx: number;
  errorRatePercent: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface HttpStatusMetricDto {
  status: number;
  statusClass: string;
  count: number;
}

export interface ModuleErrorMetricDto {
  module: string;
  version: string;
  requests: number;
  errors4xx: number;
  errors5xx: number;
  errorRatePercent: number;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface InstanceResourceMetricDto {
  runtime: string;
  instance: string;
  version: string;
  cpuPercent: number | null;
  memoryPercent: number | null;
  rssMb: number | null;
  heapUsedMb: number | null;
  eventLoopMeanMs: number | null;
  eventLoopP99Ms: number | null;
  uptimeSec: number | null;
  status: string;
}

export interface DbPoolMetricDto {
  state: string;
  used: number | null;
  idle: number | null;
  waiting: number | null;
  limit: number | null;
  utilizationPercent: number | null;
  sessions: number | null;
}

export interface QueueMetricDto {
  queue: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  backlog: number;
  oldestJobAgeSec: number | null;
  paused: boolean;
}

export interface RedisDependencyLatencyDto {
  status: string;
  sampleCount: number;
  pingMs: number | null;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
}

export interface ProviderLatencyMetricDto {
  provider: string;
  source: 'http-client' | 'provider-registry';
  requests: number;
  failures: number;
  errorRatePercent: number;
  avgMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  circuitState: string | null;
}

export interface MetricsOverviewDto {
  source: 'prometheus' | 'local';
  rangeMinutes: number;
  collectedAt: string;
  http: {
    totalRequests: number;
    requestsPerSecond: number;
    errors4xx: number;
    errors5xx: number;
    errorRatePercent: number;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    byStatus: HttpStatusMetricDto[];
    byEndpoint: HttpApiMetricDto[];
  };
  errorsByModule: ModuleErrorMetricDto[];
  instances: InstanceResourceMetricDto[];
  database: DbPoolMetricDto;
  queues: QueueMetricDto[];
  redis: RedisDependencyLatencyDto;
  providers: ProviderLatencyMetricDto[];
  activeAlerts: {
    total: number;
    critical: number;
    warning: number;
    info: number;
  };
}

export interface AlertRuleDto {
  id: number;
  code: string;
  name: string;
  description: string | null;
  isEnabled: boolean;
  metricKey: string;
  scope: Record<string, string> | null;
  operator: AlertOperatorDto;
  threshold: number;
  windowSeconds: number;
  forSeconds: number;
  cooldownSeconds: number;
  severity: AlertSeverityDto;
  channels: AlertChannelDto[];
  webhookUrl: string | null;
  isSystem: boolean;
  lastEvaluatedAt: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertDeliveryDto {
  channel: AlertChannelDto;
  status: 'sent' | 'skipped' | 'failed';
  target?: string;
  error?: string;
  at: string;
}

export interface AlertEventDto {
  id: number;
  ruleId: number;
  ruleCode: string;
  ruleName: string;
  fingerprint: string;
  severity: AlertSeverityDto;
  status: AlertEventStatusDto;
  metricKey: string;
  metricValue: number;
  threshold: number;
  operator: AlertOperatorDto;
  labels: Record<string, string>;
  summary: string;
  firedAt: string;
  lastEvaluatedAt: string;
  lastNotifiedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgeNote: string | null;
  resolvedAt: string | null;
  deliveryStatus: AlertDeliveryDto[];
}

export interface PaginatedDto<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number | null;
    totalPages: number | null;
  };
}

export interface CreateAlertRuleInput {
  code: string;
  name: string;
  description?: string | null;
  isEnabled?: boolean;
  metricKey: string;
  operator: AlertOperatorDto;
  threshold: number;
  windowSeconds: number;
  forSeconds: number;
  cooldownSeconds: number;
  severity: AlertSeverityDto;
  webhookUrl?: string | null;
}

export interface UpdateAlertRuleInput {
  name?: string;
  description?: string | null;
  isEnabled?: boolean;
  metricKey?: string;
  operator?: AlertOperatorDto;
  threshold?: number;
  windowSeconds?: number;
  forSeconds?: number;
  cooldownSeconds?: number;
  severity?: AlertSeverityDto;
  webhookUrl?: string | null;
}

export interface AlertEvaluationSummaryDto {
  evaluatedRules: number;
  firingCount: number;
  firedNew: number;
  renotified: number;
  autoResolved: number;
  evaluatedAt: string;
}

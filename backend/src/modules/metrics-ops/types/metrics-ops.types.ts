import type {
  AlertChannel,
  AlertEventStatus,
  AlertMetricKey,
  AlertOperator,
  AlertSeverity,
} from '../enum/metrics-ops.enum.js';

export type MetricsTelemetrySource = 'prometheus' | 'local';

export interface AlertRuleScope {
  readonly module?: string | undefined;
  readonly version?: string | undefined;
  readonly route?: string | undefined;
  readonly instance?: string | undefined;
  readonly runtime?: string | undefined;
  readonly queue?: string | undefined;
  readonly provider?: string | undefined;
}

export interface AlertNotifyTargets {
  readonly userIds?: readonly number[] | undefined;
  readonly roleCodes?: readonly string[] | undefined;
}

export interface AlertDeliveryRecord {
  readonly channel: AlertChannel;
  readonly status: 'sent' | 'skipped' | 'failed';
  readonly target?: string | undefined;
  readonly error?: string | undefined;
  readonly at: string;
}

export interface MetricSamplePoint {
  readonly value: number;
  readonly labels: Record<string, string>;
}

export interface HttpApiMetricItem {
  readonly method: string;
  readonly route: string;
  readonly module: string;
  readonly requests: number;
  readonly rps: number;
  readonly errors4xx: number;
  readonly errors5xx: number;
  readonly errorRatePercent: number;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly p99Ms: number | null;
}

export interface HttpStatusMetricItem {
  readonly status: number;
  readonly statusClass: string;
  readonly count: number;
}

export interface ModuleErrorMetricItem {
  readonly module: string;
  readonly version: string;
  readonly requests: number;
  readonly errors4xx: number;
  readonly errors5xx: number;
  readonly errorRatePercent: number;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly p99Ms: number | null;
}

export interface InstanceResourceMetricItem {
  readonly runtime: string;
  readonly instance: string;
  readonly version: string;
  readonly cpuPercent: number | null;
  readonly memoryPercent: number | null;
  readonly rssMb: number | null;
  readonly heapUsedMb: number | null;
  readonly eventLoopMeanMs: number | null;
  readonly eventLoopP99Ms: number | null;
  readonly uptimeSec: number | null;
  readonly status: string;
}

export interface DbPoolMetricSummary {
  readonly state: string;
  readonly used: number | null;
  readonly idle: number | null;
  readonly waiting: number | null;
  readonly limit: number | null;
  readonly utilizationPercent: number | null;
  readonly sessions: number | null;
}

export interface QueueMetricItem {
  readonly queue: string;
  readonly waiting: number;
  readonly active: number;
  readonly delayed: number;
  readonly failed: number;
  readonly backlog: number;
  readonly oldestJobAgeSec: number | null;
  readonly paused: boolean;
}

export interface RedisDependencyLatencySummary {
  readonly status: string;
  readonly sampleCount: number;
  readonly pingMs: number | null;
  readonly avgMs: number | null;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly p99Ms: number | null;
}

export interface ProviderLatencyMetricItem {
  readonly provider: string;
  readonly source: 'http-client' | 'provider-registry';
  readonly requests: number;
  readonly failures: number;
  readonly errorRatePercent: number;
  readonly avgMs: number | null;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly p99Ms: number | null;
  readonly circuitState: string | null;
}

export interface MetricsOverviewView {
  readonly source: MetricsTelemetrySource;
  readonly rangeMinutes: number;
  readonly collectedAt: string;
  readonly http: {
    readonly totalRequests: number;
    readonly requestsPerSecond: number;
    readonly errors4xx: number;
    readonly errors5xx: number;
    readonly errorRatePercent: number;
    readonly p50Ms: number | null;
    readonly p95Ms: number | null;
    readonly p99Ms: number | null;
    readonly byStatus: readonly HttpStatusMetricItem[];
    readonly byEndpoint: readonly HttpApiMetricItem[];
  };
  readonly errorsByModule: readonly ModuleErrorMetricItem[];
  readonly instances: readonly InstanceResourceMetricItem[];
  readonly database: DbPoolMetricSummary;
  readonly queues: readonly QueueMetricItem[];
  readonly redis: RedisDependencyLatencySummary;
  readonly providers: readonly ProviderLatencyMetricItem[];
  readonly activeAlerts: {
    readonly total: number;
    readonly critical: number;
    readonly warning: number;
    readonly info: number;
  };
}

export interface AlertRuleView {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly isEnabled: boolean;
  readonly metricKey: AlertMetricKey;
  readonly scope: AlertRuleScope | null;
  readonly operator: AlertOperator;
  readonly threshold: number;
  readonly windowSeconds: number;
  readonly forSeconds: number;
  readonly cooldownSeconds: number;
  readonly severity: AlertSeverity;
  readonly channels: readonly AlertChannel[];
  readonly webhookUrl: string | null;
  readonly notifyTargets: AlertNotifyTargets | null;
  readonly isSystem: boolean;
  readonly lastEvaluatedAt: string | null;
  readonly lastTriggeredAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AlertEventView {
  readonly id: number;
  readonly ruleId: number;
  readonly ruleCode: string;
  readonly ruleName: string;
  readonly fingerprint: string;
  readonly severity: AlertSeverity;
  readonly status: AlertEventStatus;
  readonly metricKey: AlertMetricKey;
  readonly metricValue: number;
  readonly threshold: number;
  readonly operator: AlertOperator;
  readonly labels: Record<string, string>;
  readonly summary: string;
  readonly firedAt: string;
  readonly lastEvaluatedAt: string;
  readonly lastNotifiedAt: string | null;
  readonly acknowledgedAt: string | null;
  readonly acknowledgedBy: number | null;
  readonly acknowledgeNote: string | null;
  readonly resolvedAt: string | null;
  readonly resolvedBy: number | null;
  readonly deliveryStatus: readonly AlertDeliveryRecord[];
}

export interface AlertEvaluationSummaryView {
  readonly evaluatedRules: number;
  readonly firingCount: number;
  readonly firedNew: number;
  readonly renotified: number;
  readonly autoResolved: number;
  readonly evaluatedAt: string;
}

export interface AlertRuleTestResultView {
  readonly ruleId: number;
  readonly ruleCode: string;
  readonly metricKey: AlertMetricKey;
  readonly matched: boolean;
  readonly samples: readonly {
    readonly value: number;
    readonly labels: Record<string, string>;
    readonly breached: boolean;
  }[];
  readonly dispatched: readonly AlertDeliveryRecord[];
}

import type {
  AlertChannel,
  AlertMetricKey,
  AlertOperator,
  AlertSeverity,
} from '../enum/metrics-ops.enum.js';
import type {
  AlertEvaluationSummaryView,
  AlertEventView,
  AlertRuleScope,
  AlertRuleView,
  MetricsOverviewView,
  ModuleErrorMetricItem,
  ProviderLatencyMetricItem,
  RedisDependencyLatencySummary,
} from '../types/metrics-ops.types.js';

export const METRICS_OPS_PUBLIC_SERVICE = Symbol('METRICS_OPS_PUBLIC_SERVICE');

export interface IMetricsOpsPublicService {
  getOverview(rangeMinutes?: number): Promise<MetricsOverviewView>;
  getErrorsByModule(rangeMinutes?: number): Promise<readonly ModuleErrorMetricItem[]>;
  getDependencies(rangeMinutes?: number): Promise<{
    readonly redis: RedisDependencyLatencySummary;
    readonly providers: readonly ProviderLatencyMetricItem[];
  }>;
  listRules(): Promise<readonly AlertRuleView[]>;
  listActiveEvents(): Promise<readonly AlertEventView[]>;
  evaluateAlerts(): Promise<AlertEvaluationSummaryView>;
}

export interface AlertDomainEventPayload extends Record<string, unknown> {
  readonly eventId: number;
  readonly ruleId: number;
  readonly ruleCode: string;
  readonly ruleName: string;
  readonly fingerprint: string;
  readonly severity: AlertSeverity;
  readonly metricKey: AlertMetricKey;
  readonly metricValue: number;
  readonly threshold: number;
  readonly operator: AlertOperator;
  readonly labels: Record<string, string>;
  readonly summary: string;
  readonly occurredAt: string;
}

export type { AlertChannel, AlertMetricKey, AlertOperator, AlertRuleScope, AlertSeverity };

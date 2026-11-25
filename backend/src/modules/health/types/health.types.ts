import type { ProviderTypeName } from '@packages/kernel/index.js';
import type { StatelessReadinessReport } from '@packages/runtime/index.js';
import type {
  HealthIndicatorStatusValue,
  HealthSeverityValue,
  HealthStatusValue,
} from '../enum/health.enum.js';

export type HealthIndicatorState = HealthIndicatorStatusValue;

export interface HealthRuntimeConfig {
  readonly dbTimeoutMs: number;
  readonly redisTimeoutMs: number;
  readonly redisDegradedLatencyMs: number;
  readonly queueBacklogWarnThreshold: number;
  readonly queueFailedWarnThreshold: number;
  readonly queueRequireActiveWorkers: boolean;
  readonly storageTimeoutMs: number;
  readonly storageWriteProbeEnabled: boolean;
  readonly providersActiveProbeEnabled: boolean;
  readonly providersTimeoutMs: number;
  readonly migrationCheckEnabled: boolean;
  readonly migrationCacheTtlSec: number;
  readonly failOnPendingMigration: boolean;
  readonly eventLoopLagWarnMs: number;
  readonly heapLimitRatio: number;
  readonly hidePublicDetails: boolean;
}

export interface HealthIndicatorDetail {
  readonly status: HealthIndicatorStatusValue;
  readonly severity?: HealthSeverityValue | undefined;
  readonly state?: string | undefined;
  readonly latencyMs?: number | null | undefined;
  readonly timeoutMs?: number | undefined;
  readonly error?: string | null | undefined;
  readonly warnings?: readonly string[] | undefined;
  readonly [key: string]: unknown;
}

export interface HealthCheckResult {
  readonly status: HealthStatusValue;
  readonly ready: boolean;
  readonly live: boolean;
  readonly uptime: number;
  readonly timestamp: string;
  readonly checks: Record<string, HealthIndicatorDetail>;
}

export interface PublicHealthCheckResult {
  readonly status: HealthStatusValue;
  readonly ready: boolean;
  readonly live: boolean;
  readonly uptime: number;
  readonly timestamp: string;
  readonly redacted: true;
}

export interface LivenessCheckResult {
  readonly status: 'ok' | 'down';
  readonly live: boolean;
  readonly uptime: number;
  readonly timestamp: string;
  readonly checks?: Record<string, HealthIndicatorDetail>;
}

export interface ReadinessCheckResult {
  readonly status: HealthStatusValue;
  readonly ready: boolean;
  readonly uptime: number;
  readonly timestamp: string;
  readonly redacted?: true;
  readonly checks?: Record<string, HealthIndicatorDetail>;
}

export interface QueueHealthItemSummary {
  readonly name: string;
  readonly waiting: number;
  readonly active: number;
  readonly delayed: number;
  readonly failed: number;
  readonly paused: boolean;
  readonly workers: number;
}

export interface ProviderEntryHealthSummary {
  readonly providerCode: string;
  readonly providerType: ProviderTypeName;
  readonly driverCode: string;
  readonly displayName: string;
  readonly isPrimary: boolean;
  readonly operationalStatus: string;
  readonly healthStatus: string;
  readonly latencyMs: number | null;
  readonly errorCode: string | null;
  readonly lastCheckedAt: string | null;
}

export interface ProviderChannelHealthSummary {
  readonly providerType: ProviderTypeName;
  readonly status: HealthIndicatorStatusValue;
  readonly configured: boolean;
  readonly total: number;
  readonly activeCount: number;
  readonly healthyCount: number;
  readonly degradedCount: number;
  readonly downCount: number;
  readonly fallbackAvailable: boolean;
  readonly resolvedProviderCode: string | null;
  readonly resolutionReason: string | null;
  readonly adapterReady: boolean | null;
  readonly providers: readonly ProviderEntryHealthSummary[];
}

export interface MigrationHealthSummary {
  readonly status: HealthIndicatorStatusValue;
  readonly enabled: boolean;
  readonly upToDate: boolean;
  readonly total: number;
  readonly applied: number;
  readonly pending: number;
  readonly tampered: number;
  readonly pendingNames: readonly string[];
  readonly tamperedNames: readonly string[];
  readonly lastRunAt: string | null;
  readonly lastRunStatus: string | null;
  readonly cached: boolean;
  readonly error?: string | null;
}

export interface DetailedHealthCheckResult {
  readonly status: HealthStatusValue;
  readonly live: boolean;
  readonly ready: boolean;
  readonly uptime: number;
  readonly timestamp: string;
  readonly runtimeState: string;
  readonly warnings: readonly string[];
  readonly criticalErrors: readonly string[];
  readonly checks: Record<string, HealthIndicatorDetail>;
  readonly dependencies: {
    readonly process: {
      readonly status: HealthIndicatorStatusValue;
      readonly runtimeState: string;
      readonly draining: boolean;
      readonly inFlightRequests: number;
      readonly eventLoopLagMs: number;
      readonly heapUsedMb: number;
      readonly heapLimitMb: number;
      readonly heapRatio: number;
      readonly rssMb: number;
    };
    readonly database: HealthIndicatorDetail;
    readonly redis: HealthIndicatorDetail;
    readonly queue: HealthIndicatorDetail & {
      readonly queues: readonly QueueHealthItemSummary[];
    };
    readonly storage: HealthIndicatorDetail & {
      readonly driver: string;
      readonly writeProbeEnabled: boolean;
    };
    readonly migration: MigrationHealthSummary;
    readonly providers: {
      readonly status: HealthIndicatorStatusValue;
      readonly email: ProviderChannelHealthSummary;
      readonly sms: ProviderChannelHealthSummary;
      readonly byType: Record<ProviderTypeName, ProviderChannelHealthSummary>;
    };
  };
  readonly stateless?: StatelessReadinessReport;
  readonly settings: HealthRuntimeConfig;
}

export type HealthIndicatorState = 'up' | 'degraded' | 'down';
export type HealthOverallStatus = 'ok' | 'degraded' | 'down';

export interface HealthIndicatorDetailDto {
  status: HealthIndicatorState;
  severity?: 'ok' | 'degraded' | 'critical';
  state?: string;
  latencyMs?: number | null;
  timeoutMs?: number;
  error?: string | null;
  warnings?: string[];
  [key: string]: unknown;
}

export interface LivenessCheckDto {
  status: 'ok' | 'down';
  live: boolean;
  uptime: number;
  timestamp: string;
}

export interface ReadinessCheckDto {
  status: HealthOverallStatus;
  ready: boolean;
  uptime: number;
  timestamp: string;
  redacted?: boolean;
}

export interface QueueHealthItemDto {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  paused: boolean;
  workers: number;
}

export interface ProviderEntryHealthDto {
  providerCode: string;
  providerType: string;
  driverCode: string;
  displayName: string;
  isPrimary: boolean;
  operationalStatus: string;
  healthStatus: string;
  latencyMs: number | null;
  errorCode: string | null;
  lastCheckedAt: string | null;
}

export interface ProviderChannelHealthDto {
  providerType: string;
  status: HealthIndicatorState;
  configured: boolean;
  total: number;
  activeCount: number;
  healthyCount: number;
  degradedCount: number;
  downCount: number;
  fallbackAvailable: boolean;
  resolvedProviderCode: string | null;
  resolutionReason: string | null;
  adapterReady: boolean | null;
  providers: ProviderEntryHealthDto[];
}

export interface MigrationHealthDto {
  status: HealthIndicatorState;
  enabled: boolean;
  upToDate: boolean;
  total: number;
  applied: number;
  pending: number;
  tampered: number;
  pendingNames: string[];
  tamperedNames: string[];
  lastRunAt: string | null;
  lastRunStatus: string | null;
  cached: boolean;
  error?: string | null;
}

export interface HealthRuntimeConfigDto {
  dbTimeoutMs: number;
  redisTimeoutMs: number;
  redisDegradedLatencyMs: number;
  queueBacklogWarnThreshold: number;
  queueFailedWarnThreshold: number;
  queueRequireActiveWorkers: boolean;
  storageTimeoutMs: number;
  storageWriteProbeEnabled: boolean;
  providersActiveProbeEnabled: boolean;
  providersTimeoutMs: number;
  migrationCheckEnabled: boolean;
  migrationCacheTtlSec: number;
  failOnPendingMigration: boolean;
  eventLoopLagWarnMs: number;
  heapLimitRatio: number;
  hidePublicDetails: boolean;
}

export interface DetailedHealthDto {
  status: HealthOverallStatus;
  live: boolean;
  ready: boolean;
  uptime: number;
  timestamp: string;
  runtimeState: string;
  warnings: string[];
  criticalErrors: string[];
  checks: Record<string, HealthIndicatorDetailDto>;
  dependencies: {
    process: {
      status: HealthIndicatorState;
      runtimeState: string;
      eventLoopLagMs: number;
      heapUsedMb: number;
      heapLimitMb: number;
      heapRatio: number;
      rssMb: number;
    };
    database: HealthIndicatorDetailDto;
    redis: HealthIndicatorDetailDto;
    queue: HealthIndicatorDetailDto & {
      queues: QueueHealthItemDto[];
    };
    storage: HealthIndicatorDetailDto & {
      driver: string;
      writeProbeEnabled: boolean;
    };
    migration: MigrationHealthDto;
    providers: {
      status: HealthIndicatorState;
      email: ProviderChannelHealthDto;
      sms: ProviderChannelHealthDto;
      byType: Record<string, ProviderChannelHealthDto>;
    };
  };
  settings: HealthRuntimeConfigDto;
}

export interface HealthSystemSettingDto {
  key: string;
  name: string;
  description: string | null;
  valueTypeName: 'TEXT' | 'NUMBER' | 'BOOLEAN' | 'JSON';
  value: unknown;
  defaultValue: unknown;
  validationRules: { min?: number; max?: number; integerOnly?: boolean } | null;
}

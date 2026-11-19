export type ProviderTypeName = 'EMAIL' | 'SMS' | 'PAYMENT' | 'STORAGE' | 'IDENTITY';
export type ProviderRoleName = 'PRIMARY' | 'FALLBACK' | 'STANDBY';
export type ProviderStatusName = 'ACTIVE' | 'PAUSED' | 'DISABLED';
export type ProviderHealthStatusName = 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'DOWN';
export type ProviderResolutionSource =
  | 'UNIT_PRIMARY'
  | 'UNIT_FALLBACK'
  | 'GLOBAL_PRIMARY'
  | 'GLOBAL_FALLBACK'
  | 'NONE';

export interface ProviderDriverCatalogItem {
  readonly driverCode: string;
  readonly displayName: string;
  readonly description: string;
  readonly defaultDomainRefCode: string | null;
  readonly suggestedSecretKeys: readonly string[];
  readonly suggestedConfigKeys: readonly string[];
}

export interface ProviderCatalogView {
  readonly types: readonly ProviderTypeName[];
  readonly driversByType: Record<ProviderTypeName, readonly ProviderDriverCatalogItem[]>;
}

export interface ProviderRegistryEntryItem {
  readonly id: number;
  readonly providerCode: string;
  readonly providerType: ProviderTypeName;
  readonly driverCode: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly domainRefCode: string | null;
  readonly httpServiceName: string | null;
  readonly role: ProviderRoleName;
  readonly priority: number;
  readonly isPrimary: boolean;
  readonly fallbackAllowed: boolean;
  readonly status: 1 | 2 | 3;
  readonly statusName: ProviderStatusName;
  readonly pausedAt: string | null;
  readonly pausedBy: number | null;
  readonly pausedReason: string | null;
  readonly secretRef: string | null;
  readonly hasEncryptedSecrets: boolean;
  readonly secretHint: string | null;
  readonly configuredSecretKeys: readonly string[];
  readonly config: Record<string, unknown>;
  readonly healthStatus: 0 | 1 | 2 | 3;
  readonly healthStatusName: ProviderHealthStatusName;
  readonly lastHealthCheckAt: string | null;
  readonly lastHealthLatencyMs: number | null;
  readonly lastHealthErrorCode: string | null;
  readonly lastHealthErrorMessage: string | null;
  readonly consecutiveFailures: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProviderUnitAssignmentItem {
  readonly id: number;
  readonly providerType: ProviderTypeName;
  readonly organizationUnitId: number;
  readonly primaryProviderId: number;
  readonly primaryProviderCode: string | null;
  readonly primaryProviderName: string | null;
  readonly fallbackProviderId: number | null;
  readonly fallbackProviderCode: string | null;
  readonly fallbackProviderName: string | null;
  readonly allowFallbackOverride: boolean | null;
  readonly isEnabled: boolean;
  readonly notes: string | null;
  readonly updatedAt: string;
}

export interface ProviderHealthCheckItem {
  readonly id: number;
  readonly providerId: number;
  readonly providerType: ProviderTypeName;
  readonly providerCode: string;
  readonly healthStatus: 0 | 1 | 2 | 3;
  readonly healthStatusName: ProviderHealthStatusName;
  readonly latencyMs: number | null;
  readonly httpStatus: number | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly checkSource: string;
  readonly details: Record<string, unknown> | null;
  readonly checkedAt: string;
}

export interface ProviderTelemetrySummary {
  readonly available: boolean;
  readonly sampleCount: number;
  readonly successCount: number;
  readonly errorCount: number;
  readonly errorRatePercent: number | null;
  readonly avgLatencyMs: number | null;
  readonly minLatencyMs: number | null;
  readonly maxLatencyMs: number | null;
  readonly p95LatencyMs: number | null;
  readonly lastErrorCode: string | null;
  readonly lastObservedAt: string | null;
}

export interface ProviderDashboardRow {
  readonly provider: ProviderRegistryEntryItem;
  readonly telemetry: ProviderTelemetrySummary;
  readonly httpClientMetrics: {
    readonly service: string;
    readonly totalRequests: number;
    readonly errorRatePercent: number;
    readonly avgDurationMs: number;
    readonly p95DurationMs: number;
  } | null;
}

export interface ProviderDashboardTypeSummary {
  readonly providerType: ProviderTypeName;
  readonly total: number;
  readonly primaryProviderCode: string | null;
  readonly activeCount: number;
  readonly pausedCount: number;
  readonly disabledCount: number;
  readonly healthyCount: number;
  readonly degradedCount: number;
  readonly downCount: number;
  readonly unknownCount: number;
  readonly sampleCount: number;
  readonly errorCount: number;
  readonly errorRatePercent: number | null;
  readonly avgLatencyMs: number | null;
}

export interface ProviderDashboardView {
  readonly windowMinutes: number;
  readonly generatedAt: string;
  readonly policy: {
    readonly fallbackEnabled: boolean;
    readonly fallbackAllowedTypes: readonly ProviderTypeName[];
    readonly fallbackOnPaused: boolean;
    readonly fallbackOnDown: boolean;
    readonly fallbackOnDegraded: boolean;
    readonly unitRoutingEnabled: boolean;
  };
  readonly thresholds: {
    readonly healthCheckTimeoutMs: number;
    readonly degradedLatencyMs: number;
    readonly degradedErrorRatePct: number;
    readonly downErrorRatePct: number;
    readonly consecutiveFailuresForDown: number;
  };
  readonly totals: {
    readonly totalProviders: number;
    readonly activeCount: number;
    readonly pausedCount: number;
    readonly disabledCount: number;
    readonly healthyCount: number;
    readonly degradedCount: number;
    readonly downCount: number;
    readonly unknownCount: number;
    readonly unitAssignmentCount: number;
    readonly totalObservations: number;
    readonly totalErrors: number;
    readonly overallErrorRatePercent: number | null;
    readonly overallAvgLatencyMs: number | null;
  };
  readonly byType: readonly ProviderDashboardTypeSummary[];
  readonly providers: readonly ProviderDashboardRow[];
}

export interface ProviderConfigHistoryItem {
  readonly id: number;
  readonly providerId: number | null;
  readonly providerType: ProviderTypeName;
  readonly providerCode: string;
  readonly action: string;
  readonly beforeState: Record<string, unknown> | null;
  readonly afterState: Record<string, unknown> | null;
  readonly changedFields: readonly string[];
  readonly reason: string | null;
  readonly actorUserId: number | null;
  readonly actorIdentifier: string | null;
  readonly ipAddress: string | null;
  readonly requestId: string | null;
  readonly createdAt: string;
}

export interface ProviderResolvePreviewResult {
  readonly resolved: boolean;
  readonly providerType: ProviderTypeName;
  readonly organizationUnitId: number | null;
  readonly usedFallback: boolean;
  readonly blockedByPolicy: boolean;
  readonly resolutionSource: ProviderResolutionSource;
  readonly reason: string;
  readonly primaryProviderCode: string | null;
  readonly provider: ProviderRegistryEntryItem | null;
}

export const ALL_PROVIDER_TYPES: readonly ProviderTypeName[] = [
  'EMAIL',
  'SMS',
  'PAYMENT',
  'STORAGE',
  'IDENTITY',
];

export const PROVIDER_TYPE_LABELS: Record<ProviderTypeName, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  PAYMENT: 'Payment',
  STORAGE: 'Storage',
  IDENTITY: 'Identity',
};

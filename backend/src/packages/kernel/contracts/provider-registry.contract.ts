export const PROVIDER_TYPE = {
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  PAYMENT: 'PAYMENT',
  STORAGE: 'STORAGE',
  IDENTITY: 'IDENTITY',
} as const;

export type ProviderTypeName = (typeof PROVIDER_TYPE)[keyof typeof PROVIDER_TYPE];

export const ALL_PROVIDER_TYPES: readonly ProviderTypeName[] = [
  PROVIDER_TYPE.EMAIL,
  PROVIDER_TYPE.SMS,
  PROVIDER_TYPE.PAYMENT,
  PROVIDER_TYPE.STORAGE,
  PROVIDER_TYPE.IDENTITY,
];

export const PROVIDER_TYPE_NUMERIC = {
  EMAIL: 1,
  SMS: 2,
  PAYMENT: 3,
  STORAGE: 4,
  IDENTITY: 5,
} as const;

export const PROVIDER_ROLE = {
  PRIMARY: 'PRIMARY',
  FALLBACK: 'FALLBACK',
  STANDBY: 'STANDBY',
} as const;

export type ProviderRoleName = (typeof PROVIDER_ROLE)[keyof typeof PROVIDER_ROLE];

export const PROVIDER_STATUS = {
  ACTIVE: 1,
  PAUSED: 2,
  DISABLED: 3,
} as const;

export type ProviderStatusCode = (typeof PROVIDER_STATUS)[keyof typeof PROVIDER_STATUS];
export type ProviderStatusName = 'ACTIVE' | 'PAUSED' | 'DISABLED';

export const PROVIDER_HEALTH_STATUS = {
  UNKNOWN: 0,
  HEALTHY: 1,
  DEGRADED: 2,
  DOWN: 3,
} as const;

export type ProviderHealthStatusCode =
  (typeof PROVIDER_HEALTH_STATUS)[keyof typeof PROVIDER_HEALTH_STATUS];
export type ProviderHealthStatusName = 'UNKNOWN' | 'HEALTHY' | 'DEGRADED' | 'DOWN';

export type ProviderResolutionSource =
  'UNIT_PRIMARY' | 'UNIT_FALLBACK' | 'GLOBAL_PRIMARY' | 'GLOBAL_FALLBACK' | 'NONE';

export interface RegisteredProviderSnapshot {
  readonly id: number;
  readonly providerCode: string;
  readonly providerType: ProviderTypeName;
  readonly driverCode: string;
  readonly displayName: string;
  readonly domainRefCode: string | null;
  readonly httpServiceName: string | null;
  readonly role: ProviderRoleName;
  readonly priority: number;
  readonly isPrimary: boolean;
  readonly fallbackAllowed: boolean;
  readonly status: ProviderStatusCode;
  readonly statusName: ProviderStatusName;
  readonly pausedAt: string | null;
  readonly pausedReason: string | null;
  readonly secretRef: string | null;
  readonly hasEncryptedSecrets: boolean;
  readonly config: Record<string, unknown>;
  readonly healthStatus: ProviderHealthStatusCode;
  readonly healthStatusName: ProviderHealthStatusName;
  readonly lastHealthCheckAt: string | null;
  readonly lastHealthLatencyMs: number | null;
  readonly lastHealthErrorCode: string | null;
}

export interface ProviderUnitAssignmentSnapshot {
  readonly id: number;
  readonly providerType: ProviderTypeName;
  readonly organizationUnitId: number;
  readonly primaryProviderId: number;
  readonly fallbackProviderId: number | null;
  readonly allowFallbackOverride: boolean | null;
  readonly isEnabled: boolean;
}

export interface ProviderFallbackPolicySnapshot {
  readonly fallbackEnabled: boolean;
  readonly fallbackAllowedTypes: readonly ProviderTypeName[];
  readonly fallbackOnPaused: boolean;
  readonly fallbackOnDown: boolean;
  readonly fallbackOnDegraded: boolean;
  readonly unitRoutingEnabled: boolean;
}

export interface ResolveProviderInput {
  readonly providerType: ProviderTypeName;
  readonly organizationUnitId?: number | null | undefined;
  readonly allowFallbackOverride?: boolean | null | undefined;
}

export interface ResolveProviderResult {
  readonly resolved: boolean;
  readonly provider: RegisteredProviderSnapshot | null;
  readonly usedFallback: boolean;
  readonly blockedByPolicy: boolean;
  readonly resolutionSource: ProviderResolutionSource;
  readonly reason: string;
  readonly primaryProviderCode: string | null;
}

export interface ProviderHealthProbeInput {
  readonly providerId: number;
  readonly providerCode: string;
  readonly providerType: ProviderTypeName;
  readonly driverCode: string;
  readonly domainRefCode: string | null;
  readonly secretRef: string | null;
  readonly config: Record<string, unknown>;
  readonly timeoutMs: number;
}

export interface ProviderHealthProbeResult {
  readonly status: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  readonly latencyMs: number;
  readonly httpStatus?: number | null | undefined;
  readonly errorCode?: string | null | undefined;
  readonly errorMessage?: string | null | undefined;
  readonly details?: Record<string, unknown> | null | undefined;
}

export type ProviderHealthProbeFn = (
  input: ProviderHealthProbeInput,
) => Promise<ProviderHealthProbeResult>;

export interface RecordProviderInvocationInput {
  readonly providerType: ProviderTypeName;
  readonly providerCode?: string | null | undefined;
  readonly driverCode?: string | null | undefined;
  readonly success: boolean;
  readonly latencyMs: number;
  readonly errorCode?: string | null | undefined;
  readonly errorMessage?: string | null | undefined;
  readonly organizationUnitId?: number | null | undefined;
  readonly occurredAt?: Date | undefined;
}

export type ProviderInvocationSink = (input: RecordProviderInvocationInput) => void | Promise<void>;

export interface IProviderRegistryPort {
  hasProvidersOfType(providerType: ProviderTypeName): boolean;
  getProviderByCode(
    providerType: ProviderTypeName,
    providerCode: string,
  ): RegisteredProviderSnapshot | null;
  findByDomainRefOrCode(
    providerType: ProviderTypeName,
    codeOrDomainRef: string,
  ): RegisteredProviderSnapshot | null;
  isProviderPaused(providerType: ProviderTypeName, codeOrDomainRef: string): boolean;
  resolveProvider(input: ResolveProviderInput): ResolveProviderResult;
  registerHealthProbe(
    providerType: ProviderTypeName,
    key: string,
    probe: ProviderHealthProbeFn,
  ): () => void;
  recordInvocation(input: RecordProviderInvocationInput): Promise<void>;
}

export const PROVIDER_REGISTRY_PORT = Symbol('PROVIDER_REGISTRY_PORT');

export function getProviderStatusName(status: number): ProviderStatusName {
  if (status === PROVIDER_STATUS.PAUSED) return 'PAUSED';
  if (status === PROVIDER_STATUS.DISABLED) return 'DISABLED';
  return 'ACTIVE';
}

export function getProviderHealthStatusName(status: number): ProviderHealthStatusName {
  if (status === PROVIDER_HEALTH_STATUS.HEALTHY) return 'HEALTHY';
  if (status === PROVIDER_HEALTH_STATUS.DEGRADED) return 'DEGRADED';
  if (status === PROVIDER_HEALTH_STATUS.DOWN) return 'DOWN';
  return 'UNKNOWN';
}

export function normalizeProviderType(raw: unknown): ProviderTypeName | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  if (
    upper === PROVIDER_TYPE.EMAIL ||
    upper === PROVIDER_TYPE.SMS ||
    upper === PROVIDER_TYPE.PAYMENT ||
    upper === PROVIDER_TYPE.STORAGE ||
    upper === PROVIDER_TYPE.IDENTITY
  ) {
    return upper;
  }
  return null;
}

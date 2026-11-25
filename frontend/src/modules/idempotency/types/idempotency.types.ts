export type IdempotencyScope = 'API' | 'JOB' | 'WEBHOOK' | 'EVENT';
export type IdempotencyStatusName = 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
export type IdempotencyAlertStatus = 'HEALTHY' | 'WARNING' | 'CRITICAL';

export interface IdempotencyScopeMetrics {
  readonly scope: IdempotencyScope;
  readonly uniqueKeys: number;
  readonly inProgressCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly duplicateHits: number;
  readonly conflictHits: number;
  readonly totalRequests: number;
  readonly duplicateRatePercent: number;
  readonly conflictRatePercent: number;
}

export interface IdempotencyClientRepeatSummary {
  readonly clientIdentifier: string;
  readonly scope: IdempotencyScope;
  readonly scopeTarget: string;
  readonly uniqueKeys: number;
  readonly duplicateHits: number;
  readonly conflictHits: number;
  readonly totalRequests: number;
  readonly duplicateRatePercent: number;
  readonly lastDuplicateAt: string | null;
  readonly suspicious: boolean;
  readonly severity: IdempotencyAlertStatus;
}

export interface IdempotencyMetricsSnapshot {
  readonly windowHours: number;
  readonly totalUniqueKeys: number;
  readonly activeKeysCount: number;
  readonly expiredPendingPurgeCount: number;
  readonly totalDuplicateHits: number;
  readonly totalConflictHits: number;
  readonly totalRequests: number;
  readonly duplicateRatePercent: number;
  readonly conflictRatePercent: number;
  readonly alertStatus: IdempotencyAlertStatus;
  readonly alertReasons: readonly string[];
  readonly byScope: readonly IdempotencyScopeMetrics[];
  readonly topRepeatedClients: readonly IdempotencyClientRepeatSummary[];
  readonly thresholds: {
    readonly duplicateRateWarnPercent: number;
    readonly duplicateRateCritPercent: number;
    readonly clientRepeatWarnHits: number;
    readonly clientRepeatCritHits: number;
  };
  readonly observedAt: string;
}

export interface IdempotencyRecordItem {
  readonly id: number;
  readonly scope: IdempotencyScope;
  readonly scopeTarget: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly status: number;
  readonly statusName: IdempotencyStatusName;
  readonly responseStatusCode: number | null;
  readonly lockOwner: string | null;
  readonly lockedUntil: string | null;
  readonly clientIdentifier: string | null;
  readonly correlationId: string | null;
  readonly duplicateHits: number;
  readonly conflictHits: number;
  readonly lastDuplicateAt: string | null;
  readonly lastConflictAt: string | null;
  readonly lastErrorCode: string | null;
  readonly lastErrorMessage: string | null;
  readonly completedAt: string | null;
  readonly expiresAt: string;
  readonly expired: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface IdempotencyRecordDetail extends IdempotencyRecordItem {
  readonly responseBody: unknown;
  readonly responseHeaders: Record<string, string>;
}

export interface IdempotencyPurgeResult {
  readonly purgedCount: number;
  readonly batchesExecuted: number;
  readonly cutoffAt: string;
  readonly executedAt: string;
}

export interface IdempotencyRevokeResult {
  readonly id: number;
  readonly scope: IdempotencyScope;
  readonly scopeTarget: string;
  readonly idempotencyKey: string;
  readonly revoked: boolean;
}

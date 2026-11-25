import type {
  IdempotencyScope,
  IdempotencyStatusCode,
  IdempotencyStatusName,
} from '../enum/idempotency.enum.js';

export interface IdempotencyRuntimeConfig {
  readonly apiTtlSec: number;
  readonly jobTtlSec: number;
  readonly webhookTtlSec: number;
  readonly eventTtlSec: number;
  readonly flowTtlOverrides: Readonly<Record<string, number>>;
  readonly lockLeaseSec: number;
  readonly maxResponseBytes: number;
  readonly cleanupBatchSize: number;
  readonly duplicateRateWarnPercent: number;
  readonly duplicateRateCritPercent: number;
  readonly clientRepeatWarnHits: number;
  readonly clientRepeatCritHits: number;
}

export interface IdempotencyRecordView {
  readonly id: number;
  readonly scope: IdempotencyScope;
  readonly scopeTarget: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly status: IdempotencyStatusCode;
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

export interface IdempotencyRecordDetailView extends IdempotencyRecordView {
  readonly responseBody: unknown;
  readonly responseHeaders: Record<string, string>;
}

export interface IdempotencyPurgeOptions {
  readonly batchSize?: number | undefined;
  readonly now?: Date | undefined;
  readonly reason?: string | undefined;
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

export interface RawScopeMetricsRow {
  readonly scope: IdempotencyScope;
  readonly uniqueKeys: number;
  readonly inProgressCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly duplicateHits: number;
  readonly conflictHits: number;
}

export interface RawClientRepeatRow {
  readonly clientIdentifier: string;
  readonly scope: IdempotencyScope;
  readonly scopeTarget: string;
  readonly uniqueKeys: number;
  readonly duplicateHits: number;
  readonly conflictHits: number;
  readonly lastDuplicateAt: Date | null;
}

export interface RawIdempotencyMetricsSummary {
  readonly activeKeysCount: number;
  readonly expiredPendingPurgeCount: number;
  readonly scopeRows: readonly RawScopeMetricsRow[];
  readonly clientRows: readonly RawClientRepeatRow[];
}

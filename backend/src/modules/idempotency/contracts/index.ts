import type {
  IdempotencyMetricsSnapshot,
  PaginatedResult,
  RawPaginationInput,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type { IdempotencyScope, IdempotencyStatusCode } from '../enum/idempotency.enum.js';
import type {
  IdempotencyPurgeOptions,
  IdempotencyPurgeResult,
  IdempotencyRecordDetailView,
  IdempotencyRecordView,
  IdempotencyRevokeResult,
} from '../types/idempotency.types.js';

export const IDEMPOTENCY_PUBLIC_SERVICE = Symbol('IDEMPOTENCY_PUBLIC_SERVICE');

export interface ListIdempotencyRecordsInput extends RawPaginationInput {
  readonly scope?: IdempotencyScope | undefined;
  readonly scopeTarget?: string | undefined;
  readonly status?: IdempotencyStatusCode | undefined;
  readonly clientIdentifier?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly onlyDuplicates?: boolean | undefined;
  readonly onlyConflicts?: boolean | undefined;
  readonly includeExpired?: boolean | undefined;
  readonly search?: string | undefined;
}

export interface IIdempotencyPublicService {
  listRecords(query: ListIdempotencyRecordsInput): Promise<PaginatedResult<IdempotencyRecordView>>;
  getRecordById(id: number): Promise<IdempotencyRecordDetailView>;
  getMetrics(windowHours?: number): Promise<IdempotencyMetricsSnapshot>;
  revokeRecord(
    id: number,
    reason?: string,
    actor?: UserIdentity,
  ): Promise<IdempotencyRevokeResult>;
  purgeExpiredRecords(
    options?: IdempotencyPurgeOptions,
    actor?: UserIdentity,
  ): Promise<IdempotencyPurgeResult>;
}

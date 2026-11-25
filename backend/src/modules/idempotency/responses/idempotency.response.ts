import { safeJsonParse, safeJsonParseObject } from '@packages/kernel/index.js';
import type { IdempotencyRecordEntity } from '../entities/idempotency-record.entity.js';
import { getIdempotencyStatusName } from '../enum/idempotency.enum.js';
import type {
  IdempotencyRecordDetailView,
  IdempotencyRecordView,
} from '../types/idempotency.types.js';

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export class IdempotencyResponseMapper {
  public static toRecordView(
    entity: IdempotencyRecordEntity,
    now: Date = new Date(),
  ): IdempotencyRecordView {
    const expiresAtDate =
      entity.expiresAt instanceof Date ? entity.expiresAt : new Date(entity.expiresAt);
    const expired = !Number.isNaN(expiresAtDate.getTime()) && expiresAtDate.getTime() <= now.getTime();

    return {
      id: Number(entity.id),
      scope: entity.scope,
      scopeTarget: entity.scopeTarget,
      idempotencyKey: entity.idempotencyKey,
      requestFingerprint: entity.requestFingerprint,
      status: entity.status,
      statusName: getIdempotencyStatusName(entity.status),
      responseStatusCode: entity.responseStatusCode ?? null,
      lockOwner: entity.lockOwner ?? null,
      lockedUntil: toIso(entity.lockedUntil),
      clientIdentifier: entity.clientIdentifier ?? null,
      correlationId: entity.correlationId ?? null,
      duplicateHits: Number(entity.duplicateHits ?? 0),
      conflictHits: Number(entity.conflictHits ?? 0),
      lastDuplicateAt: toIso(entity.lastDuplicateAt),
      lastConflictAt: toIso(entity.lastConflictAt),
      lastErrorCode: entity.lastErrorCode ?? null,
      lastErrorMessage: entity.lastErrorMessage ?? null,
      completedAt: toIso(entity.completedAt),
      expiresAt: toIso(entity.expiresAt) ?? now.toISOString(),
      expired,
      createdAt: toIso(entity.createdAt) ?? now.toISOString(),
      updatedAt: toIso(entity.updatedAt) ?? now.toISOString(),
    };
  }

  public static toRecordDetailView(
    entity: IdempotencyRecordEntity,
    now: Date = new Date(),
  ): IdempotencyRecordDetailView {
    const base = IdempotencyResponseMapper.toRecordView(entity, now);
    const responseBody = entity.responseBodyJson
      ? safeJsonParse<unknown>(entity.responseBodyJson, null)
      : null;
    const responseHeaders = entity.responseHeadersJson
      ? safeJsonParseObject<Record<string, string>>(entity.responseHeadersJson, {})
      : {};

    return {
      ...base,
      responseBody,
      responseHeaders,
    };
  }
}

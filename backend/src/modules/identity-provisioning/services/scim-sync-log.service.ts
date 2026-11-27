import { Injectable, Logger } from '@nestjs/common';
import { type PaginatedResult, safeJsonParseObject } from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { ScimSyncOutcome } from '../enum/identity-provisioning.enum.js';
import type { ScimSyncLogEntity } from '../entities/scim-sync-log.entity.js';
import { redactScimPayload } from '../helpers/scim-security.helper.js';
import {
  type ListScimSyncLogsFilter,
  ScimSyncLogRepository,
} from '../repositories/scim-sync-log.repository.js';
import type { ScimSyncLogView } from '../types/identity-provisioning.types.js';

export interface RecordScimSyncLogInput {
  readonly clientId: number | null;
  readonly requestId?: string | null | undefined;
  readonly correlationId?: string | null | undefined;
  readonly operation: string;
  readonly resourceType: string;
  readonly resourceId?: string | null | undefined;
  readonly externalId?: string | null | undefined;
  readonly httpMethod: string;
  readonly httpPath: string;
  readonly httpStatus: number;
  readonly outcome: ScimSyncOutcome;
  readonly idempotencyHit?: boolean | undefined;
  readonly requestSummary?: unknown;
  readonly responseSummary?: unknown;
  readonly errorCode?: string | null | undefined;
  readonly errorMessage?: string | null | undefined;
  readonly ipAddress?: string | null | undefined;
  readonly durationMs?: number | undefined;
}

function safeTruncatedJson(value: unknown, maxBytes = 8192): string | null {
  if (value === undefined || value === null) return null;
  const redacted = redactScimPayload(value) ?? value;
  try {
    const str = JSON.stringify(redacted);
    if (!str) return null;
    if (str.length <= maxBytes) return str;
    return JSON.stringify({ truncated: true, preview: str.slice(0, maxBytes - 64) });
  } catch {
    return null;
  }
}

@Injectable()
export class ScimSyncLogService {
  private readonly logger = new Logger(ScimSyncLogService.name);

  constructor(private readonly syncLogRepository: ScimSyncLogRepository) {}

  public toView(entity: ScimSyncLogEntity): ScimSyncLogView {
    return {
      id: Number(entity.id),
      clientId: entity.clientId !== null ? Number(entity.clientId) : null,
      requestId: entity.requestId ?? null,
      correlationId: entity.correlationId ?? null,
      operation: entity.operation,
      resourceType: entity.resourceType,
      resourceId: entity.resourceId ?? null,
      externalId: entity.externalId ?? null,
      httpMethod: entity.httpMethod,
      httpPath: entity.httpPath,
      httpStatus: Number(entity.httpStatus),
      outcome: entity.outcome,
      idempotencyHit: Boolean(entity.idempotencyHit),
      requestSummary: entity.requestSummaryJson
        ? safeJsonParseObject(entity.requestSummaryJson)
        : null,
      responseSummary: entity.responseSummaryJson
        ? safeJsonParseObject(entity.responseSummaryJson)
        : null,
      errorCode: entity.errorCode ?? null,
      errorMessage: entity.errorMessage ?? null,
      ipAddress: entity.ipAddress ?? null,
      durationMs: Number(entity.durationMs ?? 0),
      createdAt: entity.createdAt
        ? new Date(entity.createdAt).toISOString()
        : new Date().toISOString(),
    };
  }

  public async record(input: RecordScimSyncLogInput): Promise<void> {
    try {
      const entity = this.syncLogRepository.create({
        clientId: input.clientId,
        requestId: input.requestId ?? null,
        correlationId: input.correlationId ?? null,
        operation: input.operation.slice(0, 40),
        resourceType: input.resourceType.slice(0, 32),
        resourceId: input.resourceId ? input.resourceId.slice(0, 128) : null,
        externalId: input.externalId ? input.externalId.slice(0, 255) : null,
        httpMethod: input.httpMethod.slice(0, 12),
        httpPath: input.httpPath.slice(0, 500),
        httpStatus: input.httpStatus,
        outcome: input.outcome,
        idempotencyHit: Boolean(input.idempotencyHit),
        requestSummaryJson: safeTruncatedJson(input.requestSummary),
        responseSummaryJson: safeTruncatedJson(input.responseSummary),
        errorCode: input.errorCode ? input.errorCode.slice(0, 80) : null,
        errorMessage: input.errorMessage ? input.errorMessage.slice(0, 500) : null,
        ipAddress: input.ipAddress ? input.ipAddress.slice(0, 64) : null,
        durationMs: Math.max(0, Math.round(input.durationMs ?? 0)),
      });
      await this.syncLogRepository.saveEntity(entity);
    } catch (error) {
      this.logger.warn(
        `Failed to persist SCIM sync log: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  public async listPaginated(
    filter: ListScimSyncLogsFilter,
  ): Promise<PaginatedResult<ScimSyncLogView>> {
    const paged = await this.syncLogRepository.listPaginated(filter);
    return createPaginatedResult(
      paged.data.map((item) => this.toView(item)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }
}

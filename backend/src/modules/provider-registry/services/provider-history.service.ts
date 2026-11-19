import { Injectable, Optional } from '@nestjs/common';
import { createPaginatedResult, maskIp } from '@packages/http/index.js';
import {
  parseNumericUserId,
  type PaginatedResult,
  type ProviderTypeName,
} from '@packages/kernel/index.js';
import { RequestContextService } from '@packages/logging/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  PROVIDER_REGISTRY_AUDIT_META,
  type ProviderHistoryAction,
} from '../enum/provider-registry.enum.js';
import {
  computeChangedFields,
  redactProviderConfigObject,
  sanitizeProviderErrorMessage,
} from '../helpers/provider-redaction.helper.js';
import { ProviderConfigHistoryRepository } from '../repositories/provider-config-history.repository.js';
import type { ListProviderConfigHistoriesQuery } from '../requests/provider-registry.requests.js';
import { ProviderRegistryResponseMapper } from '../responses/provider-registry.response.js';
import type { ProviderConfigHistoryView } from '../types/provider-registry.types.js';

export interface RecordProviderConfigChangeInput {
  readonly providerId?: number | null | undefined;
  readonly providerType: ProviderTypeName;
  readonly providerCode: string;
  readonly action: ProviderHistoryAction | string;
  readonly beforeState?: Record<string, unknown> | null | undefined;
  readonly afterState?: Record<string, unknown> | null | undefined;
  readonly reason?: string | null | undefined;
  readonly feature?: string | undefined;
  readonly resourceType?: string | undefined;
  readonly resourceId?: string | undefined;
  readonly actor?: UserIdentity | undefined;
}

@Injectable()
export class ProviderHistoryService {
  constructor(
    private readonly historyRepo: ProviderConfigHistoryRepository,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {}

  public async recordChange(input: RecordProviderConfigChangeInput): Promise<void> {
    const ctx = RequestContextService.current();
    const actor = input.actor ?? (ctx?.actor as UserIdentity | undefined);
    const actorUserId = parseNumericUserId(actor?.id);
    const actorIdentifier =
      actor?.email ??
      actor?.username ??
      actor?.clientId ??
      (actorUserId ? `user:${actorUserId}` : 'system');

    const safeBefore = input.beforeState ? redactProviderConfigObject(input.beforeState) : null;
    const safeAfter = input.afterState ? redactProviderConfigObject(input.afterState) : null;
    const changedFields = computeChangedFields(safeBefore, safeAfter);
    const safeReason = sanitizeProviderErrorMessage(input.reason);

    await this.historyRepo
      .saveEntity({
        providerId: input.providerId ?? null,
        providerType: input.providerType,
        providerCode: input.providerCode.trim().toLowerCase(),
        action: input.action,
        beforeStateJson: safeBefore ? JSON.stringify(safeBefore) : null,
        afterStateJson: safeAfter ? JSON.stringify(safeAfter) : null,
        changedFieldsJson: JSON.stringify(changedFields),
        reason: safeReason,
        actorUserId,
        actorIdentifier,
        ipAddress: ctx?.ipAddress ? maskIp(ctx.ipAddress) : null,
        userAgent: ctx?.userAgent ? ctx.userAgent.slice(0, 250) : null,
        requestId: ctx?.requestId ?? null,
        correlationId: ctx?.correlationId ?? null,
      })
      .catch(() => undefined);

    await this.auditLogService
      ?.record({
        actor: actor ?? null,
        actorUserId,
        module: PROVIDER_REGISTRY_AUDIT_META.MODULE,
        feature: input.feature ?? PROVIDER_REGISTRY_AUDIT_META.FEATURES.ENTRIES,
        action: input.action,
        resourceType: input.resourceType ?? 'provider_registry_entry',
        resourceId:
          input.resourceId ??
          (input.providerId
            ? String(input.providerId)
            : `${input.providerType}:${input.providerCode}`),
        beforeData: safeBefore,
        afterData: safeAfter,
        reason:
          safeReason ?? `${input.action} ${input.providerType} provider ${input.providerCode}`,
      })
      .catch(() => undefined);
  }

  public async listHistories(
    query: Partial<ListProviderConfigHistoriesQuery> = {},
  ): Promise<PaginatedResult<ProviderConfigHistoryView>> {
    const paged = await this.historyRepo.listPaginated(query);
    return createPaginatedResult(
      paged.data.map((entity) => ProviderRegistryResponseMapper.toHistoryView(entity)),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }
}

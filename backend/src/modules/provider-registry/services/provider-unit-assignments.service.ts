import { Inject, Injectable, Optional } from '@nestjs/common';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  BadRequestAppException,
  NotFoundAppException,
  SettingRegistryService,
  defaultSettingRegistry,
  parseNumericUserId,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { BaseMessagePublisherProvider, QUEUES } from '@packages/messaging/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import {
  type IOrganizationsPublicService,
  ORGANIZATIONS_PUBLIC_SERVICE,
} from '@modules/organizations/contracts/index.js';
import {
  PROVIDER_HISTORY_ACTION,
  PROVIDER_REGISTRY_AUDIT_META,
  PROVIDER_REGISTRY_EVENTS,
} from '../enum/provider-registry.enum.js';
import type { ProviderRegistryEntryEntity } from '../entities/provider-registry-entry.entity.js';
import { resolveProviderRegistryConfig } from '../helpers/provider-config.helper.js';
import { ProviderRegistryEntryRepository } from '../repositories/provider-registry-entry.repository.js';
import { ProviderUnitAssignmentRepository } from '../repositories/provider-unit-assignment.repository.js';
import type {
  ListProviderUnitAssignmentsQuery,
  UpsertProviderUnitAssignmentRequest,
} from '../requests/provider-registry.requests.js';
import { ProviderRegistryResponseMapper } from '../responses/provider-registry.response.js';
import type { ProviderUnitAssignmentView } from '../types/provider-registry.types.js';
import { ProviderEntriesService } from './provider-entries.service.js';
import { ProviderHistoryService } from './provider-history.service.js';

@Injectable()
export class ProviderUnitAssignmentsService {
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    private readonly unitRepo: ProviderUnitAssignmentRepository,
    private readonly entryRepo: ProviderRegistryEntryRepository,
    private readonly entriesService: ProviderEntriesService,
    private readonly historyService: ProviderHistoryService,
    @Optional()
    @Inject(ORGANIZATIONS_PUBLIC_SERVICE)
    private readonly organizationsService?: IOrganizationsPublicService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() private readonly messagePublisher?: BaseMessagePublisherProvider,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
  }

  public async listUnitAssignments(
    query: Partial<ListProviderUnitAssignmentsQuery> = {},
  ): Promise<PaginatedResult<ProviderUnitAssignmentView>> {
    const [paged, entries] = await Promise.all([
      this.unitRepo.listPaginated(query),
      this.entryRepo.listAll(),
    ]);
    const lookup = new Map<number, ProviderRegistryEntryEntity>(
      entries.map((entry) => [Number(entry.id), entry]),
    );
    return createPaginatedResult(
      paged.data.map((assign) =>
        ProviderRegistryResponseMapper.toUnitAssignmentView(assign, lookup),
      ),
      paged.meta.total,
      paged.meta.page,
      paged.meta.limit,
    );
  }

  public async upsertUnitAssignment(
    input: UpsertProviderUnitAssignmentRequest,
    actor?: UserIdentity,
  ): Promise<ProviderUnitAssignmentView> {
    const runtimeConfig = resolveProviderRegistryConfig(this.settingRegistry);
    if (!runtimeConfig.unitRoutingEnabled) {
      throw new BadRequestAppException('provider-registry.unitRoutingDisabled');
    }

    if (this.organizationsService) {
      const units = await this.organizationsService.ensureActiveUnitsExist([
        input.organizationUnitId,
      ]);
      if (units.length === 0) {
        throw new NotFoundAppException('provider-registry.unitNotFound', {
          organizationUnitId: input.organizationUnitId,
        });
      }
    }

    const primary = await this.entriesService.getEntryOrThrow(input.primaryProviderId);
    if (primary.providerType !== input.providerType) {
      throw new BadRequestAppException('provider-registry.providerTypeMismatch', [
        { providerId: primary.id, expected: input.providerType, actual: primary.providerType },
      ]);
    }

    let fallback: ProviderRegistryEntryEntity | null = null;
    if (input.fallbackProviderId !== undefined && input.fallbackProviderId !== null) {
      if (Number(input.fallbackProviderId) === Number(input.primaryProviderId)) {
        throw new BadRequestAppException('provider-registry.samePrimaryAndFallback', [
          { providerId: input.primaryProviderId },
        ]);
      }
      fallback = await this.entriesService.getEntryOrThrow(input.fallbackProviderId);
      if (fallback.providerType !== input.providerType) {
        throw new BadRequestAppException('provider-registry.providerTypeMismatch', [
          {
            providerId: fallback.id,
            expected: input.providerType,
            actual: fallback.providerType,
          },
        ]);
      }
    }

    const existing = await this.unitRepo.findByTypeAndOrgUnit(
      input.providerType,
      input.organizationUnitId,
      true,
    );
    const lookup = new Map<number, ProviderRegistryEntryEntity>([
      [Number(primary.id), primary],
      ...(fallback ? ([[Number(fallback.id), fallback]] as const) : []),
    ]);

    const beforeView =
      existing && !existing.deletedAt
        ? ProviderRegistryResponseMapper.toUnitAssignmentView(existing, lookup)
        : null;

    const actorUserId = parseNumericUserId(actor?.id);
    const saved = await this.unitRepo.saveEntity({
      ...(existing ? { id: existing.id, deletedAt: null } : {}),
      providerType: input.providerType,
      organizationUnitId: Number(input.organizationUnitId),
      primaryProviderId: Number(input.primaryProviderId),
      fallbackProviderId: fallback ? Number(fallback.id) : null,
      allowFallbackOverride:
        input.allowFallbackOverride !== undefined ? input.allowFallbackOverride : null,
      isEnabled: input.isEnabled ?? true,
      notes: input.notes?.trim() || null,
      createdBy: existing?.createdBy ?? actorUserId,
      updatedBy: actorUserId,
    });

    await this.entriesService.afterEntryMutated();
    const afterView = ProviderRegistryResponseMapper.toUnitAssignmentView(saved, lookup);

    await this.historyService.recordChange({
      providerId: Number(primary.id),
      providerType: input.providerType,
      providerCode: primary.providerCode,
      action: PROVIDER_HISTORY_ACTION.UNIT_ASSIGN,
      beforeState: beforeView as unknown as Record<string, unknown> | null,
      afterState: afterView as unknown as Record<string, unknown>,
      reason:
        input.reason?.trim() ||
        `Assigned unit #${input.organizationUnitId} (${input.providerType}) -> primary "${primary.providerCode}"`,
      feature: PROVIDER_REGISTRY_AUDIT_META.FEATURES.UNIT_ASSIGNMENTS,
      resourceType: 'provider_unit_assignment',
      resourceId: String(saved.id),
      actor,
    });

    await this.messagePublisher
      ?.publish(
        PROVIDER_REGISTRY_EVENTS.UNIT_ASSIGNMENT_UPDATED,
        {
          assignmentId: afterView.id,
          providerType: afterView.providerType,
          organizationUnitId: afterView.organizationUnitId,
          primaryProviderCode: primary.providerCode,
          fallbackProviderCode: fallback?.providerCode ?? null,
        },
        QUEUES.SYSTEM_EVENTS,
      )
      .catch(() => undefined);

    return afterView;
  }

  public async deleteUnitAssignment(
    id: number,
    reason?: string,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    const existing = await this.unitRepo.findByIdSafe(id);
    if (!existing) {
      throw new NotFoundAppException('provider-registry.unitAssignmentNotFound', { id });
    }

    const entries = await this.entryRepo.listAll();
    const lookup = new Map<number, ProviderRegistryEntryEntity>(
      entries.map((entry) => [Number(entry.id), entry]),
    );
    const beforeView = ProviderRegistryResponseMapper.toUnitAssignmentView(existing, lookup);
    const primary = lookup.get(Number(existing.primaryProviderId));

    existing.isEnabled = false;
    existing.updatedBy = parseNumericUserId(actor?.id);
    await this.unitRepo.saveEntity(existing);
    await this.unitRepo.repository.softDelete({ id: existing.id });

    await this.entriesService.afterEntryMutated();

    await this.historyService.recordChange({
      providerId: primary ? Number(primary.id) : null,
      providerType: existing.providerType,
      providerCode: primary?.providerCode ?? `unit-${existing.organizationUnitId}`,
      action: PROVIDER_HISTORY_ACTION.UNIT_UNASSIGN,
      beforeState: beforeView as unknown as Record<string, unknown>,
      afterState: null,
      reason:
        reason?.trim() ||
        `Removed unit #${existing.organizationUnitId} assignment for ${existing.providerType}`,
      feature: PROVIDER_REGISTRY_AUDIT_META.FEATURES.UNIT_ASSIGNMENTS,
      resourceType: 'provider_unit_assignment',
      resourceId: String(existing.id),
      actor,
    });

    return { deleted: true, id: Number(existing.id) };
  }
}

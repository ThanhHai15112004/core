import { Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  DATA_GOVERNANCE_DOMAIN_EVENTS,
  DomainEventBusService,
  FeatureFlagRegistryService,
  ForbiddenAppException,
  NotFoundAppException,
  SequenceRegistryService,
  SettingRegistryService,
  createDomainEvent,
  defaultDomainEventBus,
  defaultFeatureFlagRegistry,
  defaultSequenceRegistry,
  defaultSettingRegistry,
  type ILegalHoldGuardEvaluator,
  type LegalHoldCheckDecision,
  type LegalHoldCheckQuery,
  type LegalHoldMatchedItem,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  LEGAL_HOLD_SCOPE_TYPE,
  LEGAL_HOLD_STATUS,
} from '../enum/data-governance.enum.js';
import { nextLegalHoldCode } from '../helpers/code-generator.helper.js';
import {
  assertDataGovernanceEnabled,
  resolveDataGovernanceRuntimeConfig,
} from '../helpers/data-governance-config.helper.js';
import { mapLegalHoldToView } from '../helpers/data-governance-mapper.helper.js';
import { DataLegalHoldRepository } from '../repositories/data-legal-hold.repository.js';
import type {
  CreateLegalHoldRequest,
  ListLegalHoldsQuery,
  ReleaseLegalHoldRequest,
} from '../requests/data-governance.requests.js';
import type { LegalHoldView } from '../types/data-governance.types.js';

@Injectable()
export class LegalHoldService implements ILegalHoldGuardEvaluator {
  private readonly settingRegistry: SettingRegistryService;
  private readonly featureFlagRegistry: FeatureFlagRegistryService;
  private readonly sequenceRegistry: SequenceRegistryService;
  private readonly eventBus: DomainEventBusService;

  constructor(
    private readonly legalHoldRepo: DataLegalHoldRepository,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() featureFlagRegistry?: FeatureFlagRegistryService,
    @Optional() sequenceRegistry?: SequenceRegistryService,
    @Optional() eventBus?: DomainEventBusService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.featureFlagRegistry = featureFlagRegistry ?? defaultFeatureFlagRegistry;
    this.sequenceRegistry = sequenceRegistry ?? defaultSequenceRegistry;
    this.eventBus = eventBus ?? defaultDomainEventBus;
  }

  public async checkLegalHold(query: LegalHoldCheckQuery): Promise<LegalHoldCheckDecision> {
    const cfg = resolveDataGovernanceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    if (!cfg.moduleEnabled || !cfg.legalHoldEnabled) {
      return { onHold: false, holds: [] };
    }

    const active = await this.legalHoldRepo.findAllActive();
    const nowMs = Date.now();
    const matched: LegalHoldMatchedItem[] = [];

    for (const h of active) {
      if (h.expiresAt && new Date(h.expiresAt).getTime() <= nowMs) {
        continue;
      }

      const matchesUser =
        h.scopeType === LEGAL_HOLD_SCOPE_TYPE.USER &&
        query.userId !== undefined &&
        query.userId !== null &&
        h.targetUserId === Number(query.userId);

      const matchesDataType =
        h.scopeType === LEGAL_HOLD_SCOPE_TYPE.DATA_TYPE &&
        Boolean(query.dataTypeCode) &&
        h.dataTypeCode?.toLowerCase() === query.dataTypeCode!.trim().toLowerCase();

      const matchesResource =
        h.scopeType === LEGAL_HOLD_SCOPE_TYPE.RESOURCE &&
        Boolean(query.resourceType) &&
        h.resourceType?.toLowerCase() === query.resourceType!.trim().toLowerCase() &&
        (h.resourceId === null ||
          (query.resourceId !== undefined &&
            query.resourceId !== null &&
            h.resourceId === String(query.resourceId)));

      if (matchesUser || matchesDataType || matchesResource) {
        matched.push({
          holdId: h.id,
          holdCode: h.holdCode,
          title: h.title,
          scopeType: h.scopeType,
          caseReference: h.caseReference,
          reason: h.reason,
          expiresAt: h.expiresAt ? new Date(h.expiresAt).toISOString() : null,
        });
      }
    }

    return {
      onHold: matched.length > 0,
      holds: matched,
    };
  }

  public async assertNotOnLegalHold(query: LegalHoldCheckQuery): Promise<void> {
    const decision = await this.checkLegalHold(query);
    if (decision.onHold) {
      throw new ConflictAppException(
        'data-governance.blockedByLegalHold',
        decision.holds.map((h) => h.holdCode),
      );
    }
  }

  public async countActiveHolds(): Promise<number> {
    const active = await this.legalHoldRepo.findAllActive();
    const nowMs = Date.now();
    return active.filter((h) => !h.expiresAt || new Date(h.expiresAt).getTime() > nowMs).length;
  }

  public async listLegalHolds(query: ListLegalHoldsQuery): Promise<PaginatedResult<LegalHoldView>> {
    const page = await this.legalHoldRepo.paginateFiltered({
      scopeType: query.scopeType,
      targetUserId: query.targetUserId,
      holdStatus: query.holdStatus,
      search: query.q,
      page: query.page,
      limit: query.limit,
    });
    return {
      data: page.data.map(mapLegalHoldToView),
      meta: page.meta,
    };
  }

  public async createLegalHold(
    dto: CreateLegalHoldRequest,
    actor: UserIdentity,
  ): Promise<LegalHoldView> {
    const cfg = resolveDataGovernanceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertDataGovernanceEnabled(cfg);
    if (!cfg.legalHoldEnabled) {
      throw new ForbiddenAppException('data-governance.legalHoldDisabled');
    }

    if (dto.scopeType === LEGAL_HOLD_SCOPE_TYPE.USER && !dto.targetUserId) {
      throw new BadRequestAppException('data-governance.legalHoldTargetRequired');
    }
    if (dto.scopeType === LEGAL_HOLD_SCOPE_TYPE.DATA_TYPE && !dto.dataTypeCode?.trim()) {
      throw new BadRequestAppException('data-governance.legalHoldTargetRequired');
    }
    if (dto.scopeType === LEGAL_HOLD_SCOPE_TYPE.RESOURCE && !dto.resourceType?.trim()) {
      throw new BadRequestAppException('data-governance.legalHoldTargetRequired');
    }

    const holdCode = await nextLegalHoldCode(this.sequenceRegistry);
    const entity = this.legalHoldRepo.create({
      holdCode,
      title: dto.title.trim(),
      caseReference: dto.caseReference?.trim() || null,
      reason: dto.reason.trim(),
      scopeType: dto.scopeType,
      targetUserId: dto.targetUserId ?? null,
      dataTypeCode: dto.dataTypeCode?.trim().toLowerCase() || null,
      resourceType: dto.resourceType?.trim().toLowerCase() || null,
      resourceId: dto.resourceId?.trim() || null,
      holdStatus: LEGAL_HOLD_STATUS.ACTIVE,
      startsAt: new Date(),
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      createdBy: actor.id,
      releasedBy: null,
      releasedAt: null,
      releaseReason: null,
    });

    const saved = await this.legalHoldRepo.saveEntity(entity);
    await this.auditLogService?.record({
      actor,
      module: 'data-governance',
      feature: 'legal-hold',
      action: 'CREATE',
      resourceType: 'data_legal_hold',
      resourceId: String(saved.id),
      afterData: mapLegalHoldToView(saved) as unknown as Record<string, unknown>,
    });
    await this.eventBus.publish(
      createDomainEvent({
        type: DATA_GOVERNANCE_DOMAIN_EVENTS.LEGAL_HOLD_CREATED,
        sourceModule: 'data-governance',
        aggregateType: 'data_legal_hold',
        aggregateId: String(saved.id),
        actorId: actor.id,
        payload: {
          holdCode: saved.holdCode,
          scopeType: saved.scopeType,
          targetUserId: saved.targetUserId,
          dataTypeCode: saved.dataTypeCode,
          resourceType: saved.resourceType,
          resourceId: saved.resourceId,
        },
      }),
    );

    return mapLegalHoldToView(saved);
  }

  public async releaseLegalHold(
    id: number,
    dto: ReleaseLegalHoldRequest,
    actor: UserIdentity,
  ): Promise<LegalHoldView> {
    const cfg = resolveDataGovernanceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertDataGovernanceEnabled(cfg);

    const existing = await this.legalHoldRepo.findById(id);
    if (!existing) {
      throw new NotFoundAppException('data-governance.legalHoldNotFound', { id });
    }
    if (existing.holdStatus !== LEGAL_HOLD_STATUS.ACTIVE) {
      throw new ConflictAppException('data-governance.legalHoldAlreadyReleased', [{ id }]);
    }

    existing.holdStatus = LEGAL_HOLD_STATUS.RELEASED;
    existing.releasedBy = actor.id;
    existing.releasedAt = new Date();
    existing.releaseReason = dto.reason.trim();

    const saved = await this.legalHoldRepo.saveEntity(existing);
    await this.auditLogService?.record({
      actor,
      module: 'data-governance',
      feature: 'legal-hold',
      action: 'RELEASE',
      resourceType: 'data_legal_hold',
      resourceId: String(saved.id),
      afterData: mapLegalHoldToView(saved) as unknown as Record<string, unknown>,
    });
    await this.eventBus.publish(
      createDomainEvent({
        type: DATA_GOVERNANCE_DOMAIN_EVENTS.LEGAL_HOLD_RELEASED,
        sourceModule: 'data-governance',
        aggregateType: 'data_legal_hold',
        aggregateId: String(saved.id),
        actorId: actor.id,
        payload: {
          holdCode: saved.holdCode,
          releaseReason: saved.releaseReason,
        },
      }),
    );

    return mapLegalHoldToView(saved);
  }

  public async expireElapsedHolds(now: Date = new Date()): Promise<number> {
    const expired = await this.legalHoldRepo.findExpiredActiveHolds(now);
    for (const h of expired) {
      h.holdStatus = LEGAL_HOLD_STATUS.EXPIRED;
      h.releaseReason = h.releaseReason ?? 'Auto-expired by scheduled sweep';
      h.releasedAt = now;
      await this.legalHoldRepo.saveEntity(h);
    }
    return expired.length;
  }
}

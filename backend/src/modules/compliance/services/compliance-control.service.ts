import { Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  COMPLIANCE_DOMAIN_EVENTS,
  ConflictAppException,
  DomainEventBusService,
  FeatureFlagRegistryService,
  NotFoundAppException,
  SequenceRegistryService,
  SettingRegistryService,
  createDomainEvent,
  defaultDomainEventBus,
  defaultFeatureFlagRegistry,
  defaultSequenceRegistry,
  defaultSettingRegistry,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import {
  assertComplianceEnabled,
  assertControlsEnabled,
  nextComplianceControlCode,
  resolveComplianceRuntimeConfig,
} from '../helpers/compliance-config.helper.js';
import { computeNextDueDate, normalizeFrameworkTags } from '../helpers/compliance.helper.js';
import { mapCheckHistoryToView, mapControlToView } from '../helpers/compliance-mapper.helper.js';
import { ComplianceCheckHistoryRepository } from '../repositories/compliance-check-history.repository.js';
import { ComplianceControlRepository } from '../repositories/compliance-control.repository.js';
import { ComplianceEvidenceRepository } from '../repositories/compliance-evidence.repository.js';
import type {
  CreateControlRequest,
  ListCheckHistoriesQuery,
  ListControlsQuery,
  RecordControlCheckRequest,
  UpdateControlRequest,
} from '../requests/compliance.requests.js';
import type {
  ComplianceCheckHistoryView,
  ComplianceControlView,
} from '../types/compliance.types.js';

@Injectable()
export class ComplianceControlService {
  private readonly settingRegistry: SettingRegistryService;
  private readonly featureFlagRegistry: FeatureFlagRegistryService;
  private readonly sequenceRegistry: SequenceRegistryService;
  private readonly eventBus: DomainEventBusService;

  constructor(
    private readonly controlRepo: ComplianceControlRepository,
    private readonly checkRepo: ComplianceCheckHistoryRepository,
    private readonly evidenceRepo: ComplianceEvidenceRepository,
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

  public async listControls(
    query: ListControlsQuery = {},
  ): Promise<PaginatedResult<ComplianceControlView>> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertComplianceEnabled(cfg);

    const page = await this.controlRepo.paginateFiltered({
      domain: query.domain,
      frameworkTag: query.frameworkTag,
      status: query.status,
      frequency: query.frequency,
      ownerUserId: query.ownerUserId,
      organizationUnitId: query.organizationUnitId,
      overdueOnly: query.overdueOnly,
      q: query.q,
      page: query.page,
      limit: query.limit,
    });

    const now = new Date();
    return createPaginatedResult(
      page.data.map((item) => mapControlToView(item, cfg.reviewReminderDaysBefore, now)),
      page.meta.total,
      page.meta.page,
      page.meta.limit,
    );
  }

  public async getControlById(id: number): Promise<ComplianceControlView> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertComplianceEnabled(cfg);
    const entity = await this.controlRepo.findById(id);
    if (!entity) {
      throw new NotFoundAppException('compliance.controlNotFound', { id });
    }
    return mapControlToView(entity, cfg.reviewReminderDaysBefore);
  }

  public async createControl(
    dto: CreateControlRequest,
    actor?: UserIdentity,
  ): Promise<ComplianceControlView> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertControlsEnabled(cfg);

    const controlCode = dto.controlCode?.trim()
      ? dto.controlCode.trim().toUpperCase()
      : await nextComplianceControlCode(this.sequenceRegistry);

    const existing = await this.controlRepo.findByCode(controlCode);
    if (existing) {
      throw new ConflictAppException('compliance.controlCodeDuplicate', undefined, { controlCode });
    }

    const now = new Date();
    const nextDueAt =
      dto.nextCheckDueAt !== undefined
        ? dto.nextCheckDueAt
          ? new Date(dto.nextCheckDueAt)
          : null
        : computeNextDueDate(dto.frequency, now);

    const tags = normalizeFrameworkTags(dto.frameworkTags);
    const entity = this.controlRepo.create({
      controlCode,
      title: dto.title.trim(),
      description: dto.description ?? null,
      domain: dto.domain.trim().toUpperCase(),
      frameworkTagsJson: JSON.stringify(tags),
      ownerUserId: dto.ownerUserId ?? actor?.id ?? null,
      organizationUnitId: dto.organizationUnitId ?? null,
      frequency: dto.frequency,
      status: dto.status,
      lastCheckedAt: null,
      nextCheckDueAt: nextDueAt,
      lastCheckResult: null,
      metadataJson: dto.metadata ? JSON.stringify(dto.metadata) : null,
      createdBy: actor?.id ?? null,
      updatedBy: actor?.id ?? null,
    });

    const saved = await this.controlRepo.saveEntity(entity);
    const view = mapControlToView(saved, cfg.reviewReminderDaysBefore, now);

    await this.eventBus
      .publish(
        createDomainEvent({
          type: COMPLIANCE_DOMAIN_EVENTS.CONTROL_SAVED,
          sourceModule: 'compliance',
          actorId: actor?.id ?? null,
          aggregateType: 'compliance_control',
          aggregateId: String(saved.id),
          payload: {
            controlCode: saved.controlCode,
            domain: saved.domain,
            frequency: saved.frequency,
          },
        }),
      )
      .catch(() => undefined);

    if (this.auditLogService) {
      await this.auditLogService.record({
        module: 'compliance',
        feature: 'control',
        action: 'COMPLIANCE_CONTROL_CREATED',
        actorId: actor?.id ?? null,
        resourceType: 'compliance_control',
        resourceId: String(saved.id),
        afterData: {
          controlCode: saved.controlCode,
          title: saved.title,
          ownerUserId: saved.ownerUserId,
          frequency: saved.frequency,
        },
      });
    }

    return view;
  }

  public async updateControl(
    id: number,
    dto: UpdateControlRequest,
    actor?: UserIdentity,
  ): Promise<ComplianceControlView> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertControlsEnabled(cfg);

    const entity = await this.controlRepo.findById(id);
    if (!entity) {
      throw new NotFoundAppException('compliance.controlNotFound', { id });
    }

    if (dto.controlCode !== undefined) {
      const normalizedCode = dto.controlCode.trim().toUpperCase();
      if (normalizedCode !== entity.controlCode) {
        const duplicate = await this.controlRepo.findByCode(normalizedCode);
        if (duplicate && Number(duplicate.id) !== Number(entity.id)) {
          throw new ConflictAppException('compliance.controlCodeDuplicate', undefined, {
            controlCode: normalizedCode,
          });
        }
        entity.controlCode = normalizedCode;
      }
    }
    if (dto.title !== undefined) entity.title = dto.title.trim();
    if (dto.description !== undefined) entity.description = dto.description;
    if (dto.domain !== undefined) entity.domain = dto.domain.trim().toUpperCase();
    if (dto.frameworkTags !== undefined) {
      entity.frameworkTagsJson = JSON.stringify(normalizeFrameworkTags(dto.frameworkTags));
    }
    if (dto.ownerUserId !== undefined) entity.ownerUserId = dto.ownerUserId;
    if (dto.organizationUnitId !== undefined) entity.organizationUnitId = dto.organizationUnitId;
    if (dto.frequency !== undefined) {
      entity.frequency = dto.frequency;
      if (dto.nextCheckDueAt === undefined) {
        entity.nextCheckDueAt = computeNextDueDate(
          dto.frequency,
          entity.lastCheckedAt ?? new Date(),
        );
      }
    }
    if (dto.status !== undefined) entity.status = dto.status;
    if (dto.nextCheckDueAt !== undefined) {
      entity.nextCheckDueAt = dto.nextCheckDueAt ? new Date(dto.nextCheckDueAt) : null;
    }
    if (dto.metadata !== undefined) {
      entity.metadataJson = dto.metadata ? JSON.stringify(dto.metadata) : null;
    }
    entity.updatedBy = actor?.id ?? null;

    const saved = await this.controlRepo.saveEntity(entity);
    const view = mapControlToView(saved, cfg.reviewReminderDaysBefore);

    await this.eventBus
      .publish(
        createDomainEvent({
          type: COMPLIANCE_DOMAIN_EVENTS.CONTROL_SAVED,
          sourceModule: 'compliance',
          actorId: actor?.id ?? null,
          aggregateType: 'compliance_control',
          aggregateId: String(saved.id),
          payload: { controlCode: saved.controlCode, status: saved.status },
        }),
      )
      .catch(() => undefined);

    if (this.auditLogService) {
      await this.auditLogService.record({
        module: 'compliance',
        feature: 'control',
        action: 'COMPLIANCE_CONTROL_UPDATED',
        actorId: actor?.id ?? null,
        resourceType: 'compliance_control',
        resourceId: String(saved.id),
        afterData: {
          controlCode: saved.controlCode,
          status: saved.status,
          frequency: saved.frequency,
          ownerUserId: saved.ownerUserId,
        },
      });
    }

    return view;
  }

  public async deleteControl(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertControlsEnabled(cfg);

    const entity = await this.controlRepo.findById(id);
    if (!entity) {
      throw new NotFoundAppException('compliance.controlNotFound', { id });
    }

    await this.controlRepo.softDeleteEntity(entity);

    await this.eventBus
      .publish(
        createDomainEvent({
          type: COMPLIANCE_DOMAIN_EVENTS.CONTROL_DELETED,
          sourceModule: 'compliance',
          actorId: actor?.id ?? null,
          aggregateType: 'compliance_control',
          aggregateId: String(id),
          payload: { controlCode: entity.controlCode },
        }),
      )
      .catch(() => undefined);

    if (this.auditLogService) {
      await this.auditLogService.record({
        module: 'compliance',
        feature: 'control',
        action: 'COMPLIANCE_CONTROL_DELETED',
        actorId: actor?.id ?? null,
        resourceType: 'compliance_control',
        resourceId: String(id),
      });
    }

    return { deleted: true, id };
  }

  public async recordCheck(
    controlId: number,
    dto: RecordControlCheckRequest,
    actor: UserIdentity,
  ): Promise<ComplianceCheckHistoryView> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertControlsEnabled(cfg);

    const control = await this.controlRepo.findById(controlId);
    if (!control) {
      throw new NotFoundAppException('compliance.controlNotFound', { id: controlId });
    }

    const validEvidenceIds: number[] = [];
    for (const evId of dto.evidenceIds ?? []) {
      const ev = await this.evidenceRepo.findById(evId);
      if (!ev || Number(ev.controlId) !== Number(control.id)) {
        throw new BadRequestAppException('compliance.evidenceNotFound', undefined, {
          evidenceId: evId,
          controlId,
        });
      }
      validEvidenceIds.push(Number(ev.id));
    }

    const checkedAt = dto.checkedAt ? new Date(dto.checkedAt) : new Date();
    const checkEntity = this.checkRepo.create({
      controlId: Number(control.id),
      checkedByUserId: actor.id,
      checkedAt,
      result: dto.result,
      score: dto.score ?? null,
      findings: dto.findings ?? null,
      remediationPlan: dto.remediationPlan ?? null,
      remediationDueAt: dto.remediationDueAt ? new Date(dto.remediationDueAt) : null,
      evidenceIdsJson: JSON.stringify(validEvidenceIds),
      metadataJson: dto.metadata ? JSON.stringify(dto.metadata) : null,
    });

    const savedCheck = await this.checkRepo.saveEntity(checkEntity);

    control.lastCheckedAt = checkedAt;
    control.lastCheckResult = dto.result;
    control.nextCheckDueAt =
      dto.nextCheckDueAt !== undefined
        ? dto.nextCheckDueAt
          ? new Date(dto.nextCheckDueAt)
          : null
        : computeNextDueDate(control.frequency, checkedAt);
    control.updatedBy = actor.id;
    await this.controlRepo.saveEntity(control);

    await this.eventBus
      .publish(
        createDomainEvent({
          type: COMPLIANCE_DOMAIN_EVENTS.CHECK_RECORDED,
          sourceModule: 'compliance',
          actorId: actor.id,
          aggregateType: 'compliance_check_history',
          aggregateId: String(savedCheck.id),
          payload: {
            controlId: control.id,
            controlCode: control.controlCode,
            result: savedCheck.result,
            score: savedCheck.score,
          },
        }),
      )
      .catch(() => undefined);

    if (this.auditLogService) {
      await this.auditLogService.record({
        module: 'compliance',
        feature: 'control_check',
        action: 'COMPLIANCE_CHECK_RECORDED',
        actorId: actor.id,
        resourceType: 'compliance_control',
        resourceId: String(control.id),
        afterData: {
          checkHistoryId: savedCheck.id,
          result: savedCheck.result,
          score: savedCheck.score,
          nextCheckDueAt: control.nextCheckDueAt?.toISOString() ?? null,
        },
      });
    }

    return mapCheckHistoryToView(savedCheck, control);
  }

  public async listCheckHistories(
    query: ListCheckHistoriesQuery = {},
  ): Promise<PaginatedResult<ComplianceCheckHistoryView>> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertComplianceEnabled(cfg);

    const fromDate = query.fromDate ? new Date(query.fromDate) : undefined;
    const toDate = query.toDate ? new Date(query.toDate) : undefined;
    const page = await this.checkRepo.paginateFiltered({
      controlId: query.controlId,
      checkedByUserId: query.checkedByUserId,
      result: query.result,
      fromDate: fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : undefined,
      toDate: toDate && !Number.isNaN(toDate.getTime()) ? toDate : undefined,
      page: query.page,
      limit: query.limit,
    });

    const allControls = await this.controlRepo.findAll();
    const controlMap = new Map(allControls.map((c) => [Number(c.id), c]));

    return createPaginatedResult(
      page.data.map((item) => mapCheckHistoryToView(item, controlMap.get(Number(item.controlId)))),
      page.meta.total,
      page.meta.page,
      page.meta.limit,
    );
  }

  public async listAllControlsForAggregation(now: Date = new Date()): Promise<ComplianceControlView[]> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    const entities = await this.controlRepo.findAll();
    return entities.map((item) => mapControlToView(item, cfg.reviewReminderDaysBefore, now));
  }

  public async listAllChecksForAggregation(): Promise<ComplianceCheckHistoryView[]> {
    const [checks, controls] = await Promise.all([
      this.checkRepo.findAll(),
      this.controlRepo.findAll(),
    ]);
    const controlMap = new Map(controls.map((c) => [Number(c.id), c]));
    return checks.map((ch) => mapCheckHistoryToView(ch, controlMap.get(Number(ch.controlId))));
  }
}

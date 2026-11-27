import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  COMPLIANCE_DOMAIN_EVENTS,
  DomainEventBusService,
  FeatureFlagRegistryService,
  NotFoundAppException,
  SettingRegistryService,
  createDomainEvent,
  defaultDomainEventBus,
  defaultFeatureFlagRegistry,
  defaultSettingRegistry,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import { AUDIT_PUBLIC_SERVICE, type IAuditPublicService } from '@modules/audit/contracts/index.js';
import { FILES_PUBLIC_SERVICE, type IFilesPublicService } from '@modules/files/contracts/index.js';
import { EVIDENCE_STATUS, EVIDENCE_TYPE } from '../enum/compliance.enum.js';
import {
  assertComplianceEnabled,
  assertControlsEnabled,
  resolveComplianceRuntimeConfig,
} from '../helpers/compliance-config.helper.js';
import { mapEvidenceToView } from '../helpers/compliance-mapper.helper.js';
import { ComplianceCheckHistoryRepository } from '../repositories/compliance-check-history.repository.js';
import { ComplianceControlRepository } from '../repositories/compliance-control.repository.js';
import { ComplianceEvidenceRepository } from '../repositories/compliance-evidence.repository.js';
import { ComplianceVendorRepository } from '../repositories/compliance-vendor.repository.js';
import type { CreateEvidenceRequest, ListEvidencesQuery } from '../requests/compliance.requests.js';
import type { ComplianceEvidenceView } from '../types/compliance.types.js';

@Injectable()
export class ComplianceEvidenceService {
  private readonly settingRegistry: SettingRegistryService;
  private readonly featureFlagRegistry: FeatureFlagRegistryService;
  private readonly eventBus: DomainEventBusService;

  constructor(
    private readonly evidenceRepo: ComplianceEvidenceRepository,
    private readonly controlRepo: ComplianceControlRepository,
    private readonly checkRepo: ComplianceCheckHistoryRepository,
    private readonly vendorRepo: ComplianceVendorRepository,
    @Optional()
    @Inject(FILES_PUBLIC_SERVICE)
    private readonly filesService?: IFilesPublicService | null,
    @Optional()
    @Inject(AUDIT_PUBLIC_SERVICE)
    private readonly auditPublicService?: IAuditPublicService | null,
    @Optional() private readonly auditLogService?: AuditLogService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() featureFlagRegistry?: FeatureFlagRegistryService,
    @Optional() eventBus?: DomainEventBusService,
  ) {
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.featureFlagRegistry = featureFlagRegistry ?? defaultFeatureFlagRegistry;
    this.eventBus = eventBus ?? defaultDomainEventBus;
  }

  public async listEvidences(
    query: ListEvidencesQuery = {},
  ): Promise<PaginatedResult<ComplianceEvidenceView>> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertComplianceEnabled(cfg);

    const page = await this.evidenceRepo.paginateFiltered({
      controlId: query.controlId,
      vendorId: query.vendorId,
      checkHistoryId: query.checkHistoryId,
      evidenceType: query.evidenceType,
      status: query.status,
      q: query.q,
      page: query.page,
      limit: query.limit,
    });

    return createPaginatedResult(
      page.data.map(mapEvidenceToView),
      page.meta.total,
      page.meta.page,
      page.meta.limit,
    );
  }

  public async createEvidence(
    dto: CreateEvidenceRequest,
    actor: UserIdentity,
  ): Promise<ComplianceEvidenceView> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertControlsEnabled(cfg);

    const control = await this.controlRepo.findById(dto.controlId);
    if (!control) {
      throw new NotFoundAppException('compliance.controlNotFound', { id: dto.controlId });
    }

    if (dto.checkHistoryId) {
      const check = await this.checkRepo.findById(dto.checkHistoryId);
      if (!check || Number(check.controlId) !== Number(control.id)) {
        throw new NotFoundAppException('compliance.checkHistoryNotFound', {
          id: dto.checkHistoryId,
        });
      }
    }

    if (dto.vendorId) {
      const vendor = await this.vendorRepo.findById(dto.vendorId);
      if (!vendor) {
        throw new NotFoundAppException('compliance.vendorNotFound', { id: dto.vendorId });
      }
    }

    this.validateEvidencePayload(dto);

    if (dto.evidenceType === EVIDENCE_TYPE.FILE && dto.fileId && this.filesService) {
      await this.filesService.ensureActiveFilesExist([dto.fileId]);
    }

    if (dto.evidenceType === EVIDENCE_TYPE.LOG && dto.auditLogId && this.auditPublicService) {
      await this.auditPublicService.getAuditLogById(dto.auditLogId);
    }

    const collectedAt = dto.collectedAt ? new Date(dto.collectedAt) : new Date();
    const validUntil = dto.validUntil ? new Date(dto.validUntil) : null;
    const status =
      validUntil && validUntil.getTime() < Date.now()
        ? EVIDENCE_STATUS.EXPIRED
        : EVIDENCE_STATUS.VALID;

    const entity = this.evidenceRepo.create({
      controlId: Number(control.id),
      checkHistoryId: dto.checkHistoryId ?? null,
      vendorId: dto.vendorId ?? null,
      evidenceType: dto.evidenceType,
      title: dto.title.trim(),
      description: dto.description ?? null,
      fileId: dto.fileId ?? null,
      auditLogId: dto.auditLogId ?? null,
      logReference: dto.logReference?.trim() ?? null,
      reportHistoryId: dto.reportHistoryId ?? null,
      reportCode: dto.reportCode?.trim() ?? null,
      externalUrl: dto.externalUrl?.trim() ?? null,
      checksumSha256: dto.checksumSha256?.trim() ?? null,
      collectedByUserId: actor.id,
      collectedAt,
      validUntil,
      status,
      metadataJson: dto.metadata ? JSON.stringify(dto.metadata) : null,
    });

    const saved = await this.evidenceRepo.saveEntity(entity);

    if (dto.evidenceType === EVIDENCE_TYPE.FILE && dto.fileId && this.filesService) {
      await this.filesService.syncEntityFileUsages({
        moduleName: 'compliance',
        entityType: 'compliance_evidence',
        entityId: saved.id,
        fieldName: 'fileId',
        fileIds: [dto.fileId],
        note: `Evidence for ${control.controlCode}: ${saved.title}`,
        actorId: actor.id,
      });
    }

    await this.eventBus
      .publish(
        createDomainEvent({
          type: COMPLIANCE_DOMAIN_EVENTS.EVIDENCE_ADDED,
          sourceModule: 'compliance',
          actorId: actor.id,
          aggregateType: 'compliance_evidence',
          aggregateId: String(saved.id),
          payload: {
            controlId: control.id,
            evidenceType: saved.evidenceType,
            fileId: saved.fileId,
            auditLogId: saved.auditLogId,
            reportCode: saved.reportCode,
          },
        }),
      )
      .catch(() => undefined);

    if (this.auditLogService) {
      await this.auditLogService.record({
        module: 'compliance',
        feature: 'evidence',
        action: 'COMPLIANCE_EVIDENCE_ADDED',
        actorId: actor.id,
        resourceType: 'compliance_evidence',
        resourceId: String(saved.id),
        afterData: {
          controlId: control.id,
          evidenceType: saved.evidenceType,
          title: saved.title,
        },
      });
    }

    return mapEvidenceToView(saved);
  }

  public async deleteEvidence(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertControlsEnabled(cfg);

    const entity = await this.evidenceRepo.findById(id);
    if (!entity) {
      throw new NotFoundAppException('compliance.evidenceNotFound', { id });
    }

    if (entity.fileId && this.filesService) {
      await this.filesService
        .syncEntityFileUsages({
          moduleName: 'compliance',
          entityType: 'compliance_evidence',
          entityId: entity.id,
          fieldName: 'fileId',
          fileIds: [],
          actorId: actor?.id ?? null,
        })
        .catch(() => undefined);
    }

    await this.evidenceRepo.softDeleteEntity(entity);

    await this.eventBus
      .publish(
        createDomainEvent({
          type: COMPLIANCE_DOMAIN_EVENTS.EVIDENCE_DELETED,
          sourceModule: 'compliance',
          actorId: actor?.id ?? null,
          aggregateType: 'compliance_evidence',
          aggregateId: String(id),
          payload: { controlId: entity.controlId },
        }),
      )
      .catch(() => undefined);

    if (this.auditLogService) {
      await this.auditLogService.record({
        module: 'compliance',
        feature: 'evidence',
        action: 'COMPLIANCE_EVIDENCE_DELETED',
        actorId: actor?.id ?? null,
        resourceType: 'compliance_evidence',
        resourceId: String(id),
      });
    }

    return { deleted: true, id };
  }

  public async listAllEvidencesForAggregation(): Promise<ComplianceEvidenceView[]> {
    const rows = await this.evidenceRepo.findAll();
    return rows.map(mapEvidenceToView);
  }

  private validateEvidencePayload(dto: CreateEvidenceRequest): void {
    switch (dto.evidenceType) {
      case EVIDENCE_TYPE.FILE:
        if (!dto.fileId) {
          throw new BadRequestAppException('compliance.evidencePayloadInvalid', undefined, {
            evidenceType: dto.evidenceType,
            missing: 'fileId',
          });
        }
        return;
      case EVIDENCE_TYPE.LOG:
        if (!dto.auditLogId && !dto.logReference?.trim()) {
          throw new BadRequestAppException('compliance.evidencePayloadInvalid', undefined, {
            evidenceType: dto.evidenceType,
            missing: 'auditLogId | logReference',
          });
        }
        return;
      case EVIDENCE_TYPE.REPORT:
        if (!dto.reportHistoryId && !dto.reportCode?.trim()) {
          throw new BadRequestAppException('compliance.evidencePayloadInvalid', undefined, {
            evidenceType: dto.evidenceType,
            missing: 'reportHistoryId | reportCode',
          });
        }
        return;
      case EVIDENCE_TYPE.LINK:
        if (!dto.externalUrl?.trim()) {
          throw new BadRequestAppException('compliance.evidencePayloadInvalid', undefined, {
            evidenceType: dto.evidenceType,
            missing: 'externalUrl',
          });
        }
        return;
    }
  }
}

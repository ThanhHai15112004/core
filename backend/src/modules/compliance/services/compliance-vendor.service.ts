import { Inject, Injectable, Optional } from '@nestjs/common';
import {
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
import { FILES_PUBLIC_SERVICE, type IFilesPublicService } from '@modules/files/contracts/index.js';
import {
  assertComplianceEnabled,
  assertVendorsEnabled,
  nextComplianceVendorCode,
  resolveComplianceRuntimeConfig,
} from '../helpers/compliance-config.helper.js';
import { computeNextDueDate, normalizeFrameworkTags } from '../helpers/compliance.helper.js';
import { mapDataAssessmentToView, mapVendorToView } from '../helpers/compliance-mapper.helper.js';
import { ComplianceVendorDataAssessmentRepository } from '../repositories/compliance-vendor-data-assessment.repository.js';
import { ComplianceVendorRepository } from '../repositories/compliance-vendor.repository.js';
import type {
  CreateVendorDataAssessmentRequest,
  CreateVendorRequest,
  ListVendorsQuery,
  UpdateVendorDataAssessmentRequest,
  UpdateVendorRequest,
} from '../requests/compliance.requests.js';
import type { ComplianceVendorView, VendorDataAssessmentView } from '../types/compliance.types.js';

@Injectable()
export class ComplianceVendorService {
  private readonly settingRegistry: SettingRegistryService;
  private readonly featureFlagRegistry: FeatureFlagRegistryService;
  private readonly sequenceRegistry: SequenceRegistryService;
  private readonly eventBus: DomainEventBusService;

  constructor(
    private readonly vendorRepo: ComplianceVendorRepository,
    private readonly assessmentRepo: ComplianceVendorDataAssessmentRepository,
    @Optional()
    @Inject(FILES_PUBLIC_SERVICE)
    private readonly filesService?: IFilesPublicService | null,
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

  public async listVendors(
    query: ListVendorsQuery = {},
  ): Promise<PaginatedResult<ComplianceVendorView>> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertComplianceEnabled(cfg);

    const page = await this.vendorRepo.paginateFiltered({
      category: query.category,
      criticality: query.criticality,
      status: query.status,
      missingFallbackOnly: query.missingFallbackOnly,
      expiringContractOnly: query.expiringContractOnly,
      contractWindowDays: cfg.contractExpiringDaysBefore,
      q: query.q,
      page: query.page,
      limit: query.limit,
    });

    const now = new Date();
    return createPaginatedResult(
      page.data.map((v) =>
        mapVendorToView(v, {
          contractExpiringDaysBefore: cfg.contractExpiringDaysBefore,
          reviewReminderDaysBefore: cfg.reviewReminderDaysBefore,
          now,
        }),
      ),
      page.meta.total,
      page.meta.page,
      page.meta.limit,
    );
  }

  public async getVendorById(id: number): Promise<ComplianceVendorView> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertComplianceEnabled(cfg);
    const entity = await this.vendorRepo.findById(id);
    if (!entity) {
      throw new NotFoundAppException('compliance.vendorNotFound', { id });
    }
    return mapVendorToView(entity, {
      contractExpiringDaysBefore: cfg.contractExpiringDaysBefore,
      reviewReminderDaysBefore: cfg.reviewReminderDaysBefore,
    });
  }

  public async createVendor(
    dto: CreateVendorRequest,
    actor?: UserIdentity,
  ): Promise<ComplianceVendorView> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertVendorsEnabled(cfg);

    const vendorCode = dto.vendorCode?.trim()
      ? dto.vendorCode.trim().toUpperCase()
      : await nextComplianceVendorCode(this.sequenceRegistry);

    const existing = await this.vendorRepo.findByCode(vendorCode);
    if (existing) {
      throw new ConflictAppException('compliance.vendorCodeDuplicate', undefined, { vendorCode });
    }

    if (dto.dpaFileId && this.filesService) {
      await this.filesService.ensureActiveFilesExist([dto.dpaFileId]);
    }

    const now = new Date();
    const lastReviewedAt = dto.lastReviewedAt ? new Date(dto.lastReviewedAt) : null;
    const nextReviewDueAt =
      dto.nextReviewDueAt !== undefined
        ? dto.nextReviewDueAt
          ? new Date(dto.nextReviewDueAt)
          : null
        : computeNextDueDate(dto.reviewFrequency, lastReviewedAt ?? now);

    const entity = this.vendorRepo.create({
      vendorCode,
      name: dto.name.trim(),
      category: dto.category,
      criticality: dto.criticality,
      status: dto.status,
      providerEntryId: dto.providerEntryId ?? null,
      websiteUrl: dto.websiteUrl ?? null,
      contactEmail: dto.contactEmail ?? null,
      ownerUserId: dto.ownerUserId ?? actor?.id ?? null,
      organizationUnitId: dto.organizationUnitId ?? null,
      contractStartDate: dto.contractStartDate ? new Date(dto.contractStartDate) : null,
      contractEndDate: dto.contractEndDate ? new Date(dto.contractEndDate) : null,
      autoRenew: dto.autoRenew,
      reviewFrequency: dto.reviewFrequency,
      lastReviewedAt,
      nextReviewDueAt,
      dpaSigned: dto.dpaSigned,
      dpaFileId: dto.dpaFileId ?? null,
      fallbackVendorName: dto.fallbackVendorName?.trim() ?? null,
      fallbackStrategy: dto.fallbackStrategy?.trim() ?? null,
      migrationRunbook: dto.migrationRunbook?.trim() ?? null,
      rtoHours: dto.rtoHours ?? null,
      exitPlanTestedAt: dto.exitPlanTestedAt ? new Date(dto.exitPlanTestedAt) : null,
      metadataJson: dto.metadata ? JSON.stringify(dto.metadata) : null,
      createdBy: actor?.id ?? null,
      updatedBy: actor?.id ?? null,
    });

    const saved = await this.vendorRepo.saveEntity(entity);

    if (dto.dpaFileId && this.filesService) {
      await this.filesService.syncEntityFileUsages({
        moduleName: 'compliance',
        entityType: 'compliance_vendor_dpa',
        entityId: saved.id,
        fieldName: 'dpaFileId',
        fileIds: [dto.dpaFileId],
        note: `DPA / Contract for vendor ${saved.vendorCode}`,
        actorId: actor?.id ?? null,
      });
    }

    await this.eventBus
      .publish(
        createDomainEvent({
          type: COMPLIANCE_DOMAIN_EVENTS.VENDOR_SAVED,
          sourceModule: 'compliance',
          actorId: actor?.id ?? null,
          aggregateType: 'compliance_vendor',
          aggregateId: String(saved.id),
          payload: {
            vendorCode: saved.vendorCode,
            category: saved.category,
            criticality: saved.criticality,
          },
        }),
      )
      .catch(() => undefined);

    if (this.auditLogService) {
      await this.auditLogService.record({
        module: 'compliance',
        feature: 'vendor',
        action: 'COMPLIANCE_VENDOR_CREATED',
        actorId: actor?.id ?? null,
        resourceType: 'compliance_vendor',
        resourceId: String(saved.id),
        afterData: {
          vendorCode: saved.vendorCode,
          name: saved.name,
          category: saved.category,
          dpaSigned: saved.dpaSigned,
          fallbackVendorName: saved.fallbackVendorName,
        },
      });
    }

    return mapVendorToView(saved, {
      contractExpiringDaysBefore: cfg.contractExpiringDaysBefore,
      reviewReminderDaysBefore: cfg.reviewReminderDaysBefore,
      now,
    });
  }

  public async updateVendor(
    id: number,
    dto: UpdateVendorRequest,
    actor?: UserIdentity,
  ): Promise<ComplianceVendorView> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertVendorsEnabled(cfg);

    const entity = await this.vendorRepo.findById(id);
    if (!entity) {
      throw new NotFoundAppException('compliance.vendorNotFound', { id });
    }

    if (dto.vendorCode !== undefined) {
      const normalizedCode = dto.vendorCode.trim().toUpperCase();
      if (normalizedCode !== entity.vendorCode) {
        const dup = await this.vendorRepo.findByCode(normalizedCode);
        if (dup && Number(dup.id) !== Number(entity.id)) {
          throw new ConflictAppException('compliance.vendorCodeDuplicate', undefined, {
            vendorCode: normalizedCode,
          });
        }
        entity.vendorCode = normalizedCode;
      }
    }

    if (dto.name !== undefined) entity.name = dto.name.trim();
    if (dto.category !== undefined) entity.category = dto.category;
    if (dto.criticality !== undefined) entity.criticality = dto.criticality;
    if (dto.status !== undefined) entity.status = dto.status;
    if (dto.providerEntryId !== undefined) entity.providerEntryId = dto.providerEntryId;
    if (dto.websiteUrl !== undefined) entity.websiteUrl = dto.websiteUrl;
    if (dto.contactEmail !== undefined) entity.contactEmail = dto.contactEmail;
    if (dto.ownerUserId !== undefined) entity.ownerUserId = dto.ownerUserId;
    if (dto.organizationUnitId !== undefined) entity.organizationUnitId = dto.organizationUnitId;
    if (dto.contractStartDate !== undefined) {
      entity.contractStartDate = dto.contractStartDate ? new Date(dto.contractStartDate) : null;
    }
    if (dto.contractEndDate !== undefined) {
      entity.contractEndDate = dto.contractEndDate ? new Date(dto.contractEndDate) : null;
    }
    if (dto.autoRenew !== undefined) entity.autoRenew = dto.autoRenew;
    if (dto.reviewFrequency !== undefined) entity.reviewFrequency = dto.reviewFrequency;
    if (dto.lastReviewedAt !== undefined) {
      entity.lastReviewedAt = dto.lastReviewedAt ? new Date(dto.lastReviewedAt) : null;
    }
    if (dto.nextReviewDueAt !== undefined) {
      entity.nextReviewDueAt = dto.nextReviewDueAt ? new Date(dto.nextReviewDueAt) : null;
    } else if (dto.reviewFrequency !== undefined || dto.lastReviewedAt !== undefined) {
      entity.nextReviewDueAt = computeNextDueDate(
        entity.reviewFrequency,
        entity.lastReviewedAt ?? new Date(),
      );
    }
    if (dto.dpaSigned !== undefined) entity.dpaSigned = dto.dpaSigned;
    if (dto.dpaFileId !== undefined) {
      if (dto.dpaFileId && this.filesService) {
        await this.filesService.ensureActiveFilesExist([dto.dpaFileId]);
      }
      entity.dpaFileId = dto.dpaFileId;
      if (this.filesService) {
        await this.filesService.syncEntityFileUsages({
          moduleName: 'compliance',
          entityType: 'compliance_vendor_dpa',
          entityId: entity.id,
          fieldName: 'dpaFileId',
          fileIds: dto.dpaFileId ? [dto.dpaFileId] : [],
          actorId: actor?.id ?? null,
        });
      }
    }
    if (dto.fallbackVendorName !== undefined) {
      entity.fallbackVendorName = dto.fallbackVendorName?.trim() ?? null;
    }
    if (dto.fallbackStrategy !== undefined) {
      entity.fallbackStrategy = dto.fallbackStrategy?.trim() ?? null;
    }
    if (dto.migrationRunbook !== undefined) {
      entity.migrationRunbook = dto.migrationRunbook?.trim() ?? null;
    }
    if (dto.rtoHours !== undefined) entity.rtoHours = dto.rtoHours;
    if (dto.exitPlanTestedAt !== undefined) {
      entity.exitPlanTestedAt = dto.exitPlanTestedAt ? new Date(dto.exitPlanTestedAt) : null;
    }
    if (dto.metadata !== undefined) {
      entity.metadataJson = dto.metadata ? JSON.stringify(dto.metadata) : null;
    }
    entity.updatedBy = actor?.id ?? null;

    const saved = await this.vendorRepo.saveEntity(entity);

    await this.eventBus
      .publish(
        createDomainEvent({
          type: COMPLIANCE_DOMAIN_EVENTS.VENDOR_SAVED,
          sourceModule: 'compliance',
          actorId: actor?.id ?? null,
          aggregateType: 'compliance_vendor',
          aggregateId: String(saved.id),
          payload: {
            vendorCode: saved.vendorCode,
            status: saved.status,
            criticality: saved.criticality,
          },
        }),
      )
      .catch(() => undefined);

    if (this.auditLogService) {
      await this.auditLogService.record({
        module: 'compliance',
        feature: 'vendor',
        action: 'COMPLIANCE_VENDOR_UPDATED',
        actorId: actor?.id ?? null,
        resourceType: 'compliance_vendor',
        resourceId: String(saved.id),
        afterData: {
          vendorCode: saved.vendorCode,
          status: saved.status,
          contractEndDate: saved.contractEndDate?.toISOString() ?? null,
          fallbackVendorName: saved.fallbackVendorName,
        },
      });
    }

    return mapVendorToView(saved, {
      contractExpiringDaysBefore: cfg.contractExpiringDaysBefore,
      reviewReminderDaysBefore: cfg.reviewReminderDaysBefore,
    });
  }

  public async deleteVendor(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertVendorsEnabled(cfg);

    const entity = await this.vendorRepo.findById(id);
    if (!entity) {
      throw new NotFoundAppException('compliance.vendorNotFound', { id });
    }

    if (entity.dpaFileId && this.filesService) {
      await this.filesService
        .syncEntityFileUsages({
          moduleName: 'compliance',
          entityType: 'compliance_vendor_dpa',
          entityId: entity.id,
          fieldName: 'dpaFileId',
          fileIds: [],
          actorId: actor?.id ?? null,
        })
        .catch(() => undefined);
    }

    await this.vendorRepo.softDeleteEntity(entity);

    await this.eventBus
      .publish(
        createDomainEvent({
          type: COMPLIANCE_DOMAIN_EVENTS.VENDOR_DELETED,
          sourceModule: 'compliance',
          actorId: actor?.id ?? null,
          aggregateType: 'compliance_vendor',
          aggregateId: String(id),
          payload: { vendorCode: entity.vendorCode },
        }),
      )
      .catch(() => undefined);

    if (this.auditLogService) {
      await this.auditLogService.record({
        module: 'compliance',
        feature: 'vendor',
        action: 'COMPLIANCE_VENDOR_DELETED',
        actorId: actor?.id ?? null,
        resourceType: 'compliance_vendor',
        resourceId: String(id),
      });
    }

    return { deleted: true, id };
  }

  public async listVendorDataAssessments(vendorId: number): Promise<VendorDataAssessmentView[]> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertComplianceEnabled(cfg);

    const vendor = await this.vendorRepo.findById(vendorId);
    if (!vendor) {
      throw new NotFoundAppException('compliance.vendorNotFound', { id: vendorId });
    }

    const rows = await this.assessmentRepo.findByVendorId(vendorId);
    return rows.map((row) => mapDataAssessmentToView(row, vendor));
  }

  public async createVendorDataAssessment(
    vendorId: number,
    dto: CreateVendorDataAssessmentRequest,
    actor: UserIdentity,
  ): Promise<VendorDataAssessmentView> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertVendorsEnabled(cfg);

    const vendor = await this.vendorRepo.findById(vendorId);
    if (!vendor) {
      throw new NotFoundAppException('compliance.vendorNotFound', { id: vendorId });
    }

    const now = new Date();
    const isReviewed = dto.approvalStatus !== 'PENDING';
    const entity = this.assessmentRepo.create({
      vendorId: Number(vendor.id),
      dataCategory: dto.dataCategory.trim(),
      classificationLevel: dto.classificationLevel,
      allowedDataFieldsJson: JSON.stringify(normalizeFrameworkTags(dto.allowedDataFields)),
      prohibitedDataFieldsJson: JSON.stringify(normalizeFrameworkTags(dto.prohibitedDataFields)),
      processingPurpose: dto.processingPurpose.trim(),
      dataFlowDirection: dto.dataFlowDirection,
      storageRegionsJson: JSON.stringify(normalizeFrameworkTags(dto.storageRegions)),
      crossBorderTransfer: dto.crossBorderTransfer,
      transferMechanism: dto.transferMechanism?.trim() ?? null,
      retentionDays: dto.retentionDays ?? null,
      encryptionInTransit: dto.encryptionInTransit,
      encryptionAtRest: dto.encryptionAtRest,
      subprocessorsJson: JSON.stringify(normalizeFrameworkTags(dto.subprocessors)),
      riskLevel: dto.riskLevel,
      approvalStatus: dto.approvalStatus,
      reviewedByUserId: isReviewed ? actor.id : null,
      reviewedAt: isReviewed ? now : null,
      nextReviewDueAt: dto.nextReviewDueAt ? new Date(dto.nextReviewDueAt) : null,
      notes: dto.notes?.trim() ?? null,
    });

    const saved = await this.assessmentRepo.saveEntity(entity);

    await this.eventBus
      .publish(
        createDomainEvent({
          type: COMPLIANCE_DOMAIN_EVENTS.VENDOR_DATA_ASSESSMENT_SAVED,
          sourceModule: 'compliance',
          actorId: actor.id,
          aggregateType: 'compliance_vendor_data_assessment',
          aggregateId: String(saved.id),
          payload: {
            vendorId: vendor.id,
            classificationLevel: saved.classificationLevel,
            riskLevel: saved.riskLevel,
            approvalStatus: saved.approvalStatus,
          },
        }),
      )
      .catch(() => undefined);

    if (this.auditLogService) {
      await this.auditLogService.record({
        module: 'compliance',
        feature: 'vendor_data_assessment',
        action: 'COMPLIANCE_VENDOR_DATA_ASSESSMENT_CREATED',
        actorId: actor.id,
        resourceType: 'compliance_vendor_data_assessment',
        resourceId: String(saved.id),
        afterData: {
          vendorId: vendor.id,
          dataCategory: saved.dataCategory,
          classificationLevel: saved.classificationLevel,
          riskLevel: saved.riskLevel,
          approvalStatus: saved.approvalStatus,
        },
      });
    }

    return mapDataAssessmentToView(saved, vendor);
  }

  public async updateVendorDataAssessment(
    id: number,
    dto: UpdateVendorDataAssessmentRequest,
    actor: UserIdentity,
  ): Promise<VendorDataAssessmentView> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertVendorsEnabled(cfg);

    const entity = await this.assessmentRepo.findById(id);
    if (!entity) {
      throw new NotFoundAppException('compliance.dataAssessmentNotFound', { id });
    }
    const vendor = await this.vendorRepo.findById(entity.vendorId);

    if (dto.dataCategory !== undefined) entity.dataCategory = dto.dataCategory.trim();
    if (dto.classificationLevel !== undefined) {
      entity.classificationLevel = dto.classificationLevel;
    }
    if (dto.allowedDataFields !== undefined) {
      entity.allowedDataFieldsJson = JSON.stringify(normalizeFrameworkTags(dto.allowedDataFields));
    }
    if (dto.prohibitedDataFields !== undefined) {
      entity.prohibitedDataFieldsJson = JSON.stringify(
        normalizeFrameworkTags(dto.prohibitedDataFields),
      );
    }
    if (dto.processingPurpose !== undefined)
      entity.processingPurpose = dto.processingPurpose.trim();
    if (dto.dataFlowDirection !== undefined) entity.dataFlowDirection = dto.dataFlowDirection;
    if (dto.storageRegions !== undefined) {
      entity.storageRegionsJson = JSON.stringify(normalizeFrameworkTags(dto.storageRegions));
    }
    if (dto.crossBorderTransfer !== undefined) {
      entity.crossBorderTransfer = dto.crossBorderTransfer;
    }
    if (dto.transferMechanism !== undefined) {
      entity.transferMechanism = dto.transferMechanism?.trim() ?? null;
    }
    if (dto.retentionDays !== undefined) entity.retentionDays = dto.retentionDays;
    if (dto.encryptionInTransit !== undefined) {
      entity.encryptionInTransit = dto.encryptionInTransit;
    }
    if (dto.encryptionAtRest !== undefined) entity.encryptionAtRest = dto.encryptionAtRest;
    if (dto.subprocessors !== undefined) {
      entity.subprocessorsJson = JSON.stringify(normalizeFrameworkTags(dto.subprocessors));
    }
    if (dto.riskLevel !== undefined) entity.riskLevel = dto.riskLevel;
    if (dto.approvalStatus !== undefined) {
      entity.approvalStatus = dto.approvalStatus;
      entity.reviewedByUserId = actor.id;
      entity.reviewedAt = new Date();
    }
    if (dto.nextReviewDueAt !== undefined) {
      entity.nextReviewDueAt = dto.nextReviewDueAt ? new Date(dto.nextReviewDueAt) : null;
    }
    if (dto.notes !== undefined) entity.notes = dto.notes?.trim() ?? null;

    const saved = await this.assessmentRepo.saveEntity(entity);

    await this.eventBus
      .publish(
        createDomainEvent({
          type: COMPLIANCE_DOMAIN_EVENTS.VENDOR_DATA_ASSESSMENT_SAVED,
          sourceModule: 'compliance',
          actorId: actor.id,
          aggregateType: 'compliance_vendor_data_assessment',
          aggregateId: String(saved.id),
          payload: {
            vendorId: saved.vendorId,
            riskLevel: saved.riskLevel,
            approvalStatus: saved.approvalStatus,
          },
        }),
      )
      .catch(() => undefined);

    return mapDataAssessmentToView(saved, vendor);
  }

  public async deleteVendorDataAssessment(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly deleted: true; readonly id: number }> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    assertVendorsEnabled(cfg);

    const entity = await this.assessmentRepo.findById(id);
    if (!entity) {
      throw new NotFoundAppException('compliance.dataAssessmentNotFound', { id });
    }
    await this.assessmentRepo.softDeleteEntity(entity);

    if (this.auditLogService) {
      await this.auditLogService.record({
        module: 'compliance',
        feature: 'vendor_data_assessment',
        action: 'COMPLIANCE_VENDOR_DATA_ASSESSMENT_DELETED',
        actorId: actor?.id ?? null,
        resourceType: 'compliance_vendor_data_assessment',
        resourceId: String(id),
      });
    }

    return { deleted: true, id };
  }

  public async listAllVendorsForAggregation(
    now: Date = new Date(),
  ): Promise<ComplianceVendorView[]> {
    const cfg = resolveComplianceRuntimeConfig(this.settingRegistry, this.featureFlagRegistry);
    const entities = await this.vendorRepo.findAll();
    return entities.map((v) =>
      mapVendorToView(v, {
        contractExpiringDaysBefore: cfg.contractExpiringDaysBefore,
        reviewReminderDaysBefore: cfg.reviewReminderDaysBefore,
        now,
      }),
    );
  }

  public async listAllAssessmentsForAggregation(): Promise<VendorDataAssessmentView[]> {
    const [assessments, vendors] = await Promise.all([
      this.assessmentRepo.findAll(),
      this.vendorRepo.findAll(),
    ]);
    const vendorMap = new Map(vendors.map((v) => [Number(v.id), v]));
    return assessments.map((a) => mapDataAssessmentToView(a, vendorMap.get(Number(a.vendorId))));
  }
}

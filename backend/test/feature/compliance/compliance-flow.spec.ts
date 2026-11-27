import { beforeEach, describe, expect, it } from '@jest/globals';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  BadRequestAppException,
  DomainEventBusService,
  ExportRegistryService,
  FeatureFlagRegistryService,
  ForbiddenAppException,
  ReportRegistryService,
  SequenceRegistryService,
  SettingRegistryService,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type { IAuditPublicService } from '../../../src/modules/audit/contracts/index.js';
import type { ComplianceCheckHistoryEntity } from '../../../src/modules/compliance/entities/compliance-check-history.entity.js';
import type { ComplianceControlEntity } from '../../../src/modules/compliance/entities/compliance-control.entity.js';
import type { ComplianceEvidenceEntity } from '../../../src/modules/compliance/entities/compliance-evidence.entity.js';
import type { ComplianceVendorDataAssessmentEntity } from '../../../src/modules/compliance/entities/compliance-vendor-data-assessment.entity.js';
import type { ComplianceVendorEntity } from '../../../src/modules/compliance/entities/compliance-vendor.entity.js';
import {
  ASSESSMENT_APPROVAL_STATUS,
  COMPLIANCE_FEATURE_FLAGS,
  COMPLIANCE_PERMISSIONS,
  COMPLIANCE_RISK_LEVEL,
  CONTROL_CHECK_RESULT,
  CONTROL_FREQUENCY,
  CONTROL_STATUS,
  DATA_FLOW_DIRECTION,
  EVIDENCE_STATUS,
  EVIDENCE_TYPE,
  VENDOR_CATEGORY,
  VENDOR_STATUS,
} from '../../../src/modules/compliance/enum/compliance.enum.js';
import { ComplianceControlService } from '../../../src/modules/compliance/services/compliance-control.service.js';
import { ComplianceEvidenceService } from '../../../src/modules/compliance/services/compliance-evidence.service.js';
import { ComplianceReportService } from '../../../src/modules/compliance/services/compliance-report.service.js';
import { ComplianceVendorService } from '../../../src/modules/compliance/services/compliance-vendor.service.js';
import { ComplianceService } from '../../../src/modules/compliance/services/compliance.service.js';
import type { IFilesPublicService } from '../../../src/modules/files/contracts/index.js';
import type { INotificationsPublicService } from '../../../src/modules/notifications/contracts/index.js';

function createComplianceTestHarness() {
  let nextId = 1;
  const controls: ComplianceControlEntity[] = [];
  const checks: ComplianceCheckHistoryEntity[] = [];
  const evidences: ComplianceEvidenceEntity[] = [];
  const vendors: ComplianceVendorEntity[] = [];
  const assessments: ComplianceVendorDataAssessmentEntity[] = [];

  const fileUsageCalls: Array<{ entityId: string | number; fileIds: readonly number[] }> = [];
  const dispatchedNotifications: Array<{ userId?: number; title?: string }> = [];
  const publishedEvents: string[] = [];

  const controlRepo = {
    create: (data: Partial<ComplianceControlEntity>) =>
      ({
        id: 0,
        controlCode: '',
        title: '',
        description: null,
        domain: 'GENERAL',
        frameworkTagsJson: '[]',
        ownerUserId: null,
        organizationUnitId: null,
        frequency: CONTROL_FREQUENCY.QUARTERLY,
        status: CONTROL_STATUS.ACTIVE,
        lastCheckedAt: null,
        nextCheckDueAt: null,
        lastCheckResult: null,
        metadataJson: null,
        createdBy: null,
        updatedBy: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...data,
      }) as ComplianceControlEntity,
    saveEntity: async (entity: ComplianceControlEntity) => {
      if (!entity.id) {
        entity.id = nextId++;
        entity.createdAt = new Date();
        entity.updatedAt = new Date();
        controls.push(entity);
      } else {
        entity.updatedAt = new Date();
      }
      return entity;
    },
    findById: async (id: number) => controls.find((c) => c.id === id && !c.deletedAt) ?? null,
    findByCode: async (code: string) =>
      controls.find((c) => c.controlCode.toUpperCase() === code.trim().toUpperCase() && !c.deletedAt) ??
      null,
    findAll: async () => controls.filter((c) => !c.deletedAt),
    softDeleteEntity: async (entity: ComplianceControlEntity) => {
      entity.deletedAt = new Date();
      return entity;
    },
    paginateFiltered: async (filter: { domain?: string; frameworkTag?: string; page?: number; limit?: number }) => {
      const items = controls.filter((c) => {
        if (c.deletedAt) return false;
        if (filter.domain && c.domain.toLowerCase() !== filter.domain.toLowerCase()) return false;
        if (
          filter.frameworkTag &&
          !(c.frameworkTagsJson ?? '').toLowerCase().includes(filter.frameworkTag.toLowerCase())
        ) {
          return false;
        }
        return true;
      });
      return createPaginatedResult(items, items.length, filter.page ?? 1, filter.limit ?? 50);
    },
  };

  const checkRepo = {
    create: (data: Partial<ComplianceCheckHistoryEntity>) =>
      ({
        id: 0,
        controlId: 0,
        checkedByUserId: 1,
        checkedAt: new Date(),
        result: CONTROL_CHECK_RESULT.PASS,
        score: null,
        findings: null,
        remediationPlan: null,
        remediationDueAt: null,
        evidenceIdsJson: '[]',
        metadataJson: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...data,
      }) as ComplianceCheckHistoryEntity,
    saveEntity: async (entity: ComplianceCheckHistoryEntity) => {
      if (!entity.id) {
        entity.id = nextId++;
        entity.createdAt = new Date();
        entity.updatedAt = new Date();
        checks.push(entity);
      }
      return entity;
    },
    findById: async (id: number) => checks.find((c) => c.id === id && !c.deletedAt) ?? null,
    findAll: async () => checks.filter((c) => !c.deletedAt),
    paginateFiltered: async (filter: { controlId?: number; page?: number; limit?: number }) => {
      const items = checks.filter(
        (c) => !c.deletedAt && (!filter.controlId || c.controlId === filter.controlId),
      );
      return createPaginatedResult(items, items.length, filter.page ?? 1, filter.limit ?? 50);
    },
  };

  const evidenceRepo = {
    create: (data: Partial<ComplianceEvidenceEntity>) =>
      ({
        id: 0,
        controlId: 0,
        checkHistoryId: null,
        vendorId: null,
        evidenceType: EVIDENCE_TYPE.LOG,
        title: '',
        description: null,
        fileId: null,
        auditLogId: null,
        logReference: null,
        reportHistoryId: null,
        reportCode: null,
        externalUrl: null,
        checksumSha256: null,
        collectedByUserId: 1,
        collectedAt: new Date(),
        validUntil: null,
        status: EVIDENCE_STATUS.VALID,
        metadataJson: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...data,
      }) as ComplianceEvidenceEntity,
    saveEntity: async (entity: ComplianceEvidenceEntity) => {
      if (!entity.id) {
        entity.id = nextId++;
        entity.createdAt = new Date();
        entity.updatedAt = new Date();
        evidences.push(entity);
      } else {
        entity.updatedAt = new Date();
      }
      return entity;
    },
    findById: async (id: number) => evidences.find((e) => e.id === id && !e.deletedAt) ?? null,
    findAll: async () => evidences.filter((e) => !e.deletedAt),
    softDeleteEntity: async (entity: ComplianceEvidenceEntity) => {
      entity.deletedAt = new Date();
      return entity;
    },
    paginateFiltered: async (filter: { controlId?: number; page?: number; limit?: number }) => {
      const items = evidences.filter(
        (e) => !e.deletedAt && (!filter.controlId || e.controlId === filter.controlId),
      );
      return createPaginatedResult(items, items.length, filter.page ?? 1, filter.limit ?? 50);
    },
  };

  const vendorRepo = {
    create: (data: Partial<ComplianceVendorEntity>) =>
      ({
        id: 0,
        vendorCode: '',
        name: '',
        category: VENDOR_CATEGORY.CLOUD,
        criticality: COMPLIANCE_RISK_LEVEL.MEDIUM,
        status: VENDOR_STATUS.ACTIVE,
        providerEntryId: null,
        websiteUrl: null,
        contactEmail: null,
        ownerUserId: null,
        organizationUnitId: null,
        contractStartDate: null,
        contractEndDate: null,
        autoRenew: false,
        reviewFrequency: CONTROL_FREQUENCY.SEMI_ANNUAL,
        lastReviewedAt: null,
        nextReviewDueAt: null,
        dpaSigned: false,
        dpaFileId: null,
        fallbackVendorName: null,
        fallbackStrategy: null,
        migrationRunbook: null,
        rtoHours: null,
        exitPlanTestedAt: null,
        metadataJson: null,
        createdBy: null,
        updatedBy: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...data,
      }) as ComplianceVendorEntity,
    saveEntity: async (entity: ComplianceVendorEntity) => {
      if (!entity.id) {
        entity.id = nextId++;
        entity.createdAt = new Date();
        entity.updatedAt = new Date();
        vendors.push(entity);
      } else {
        entity.updatedAt = new Date();
      }
      return entity;
    },
    findById: async (id: number) => vendors.find((v) => v.id === id && !v.deletedAt) ?? null,
    findByCode: async (code: string) =>
      vendors.find((v) => v.vendorCode.toUpperCase() === code.trim().toUpperCase() && !v.deletedAt) ??
      null,
    findAll: async () => vendors.filter((v) => !v.deletedAt),
    softDeleteEntity: async (entity: ComplianceVendorEntity) => {
      entity.deletedAt = new Date();
      return entity;
    },
    paginateFiltered: async (filter: { category?: string; page?: number; limit?: number }) => {
      const items = vendors.filter(
        (v) => !v.deletedAt && (!filter.category || v.category === filter.category),
      );
      return createPaginatedResult(items, items.length, filter.page ?? 1, filter.limit ?? 50);
    },
  };

  const assessmentRepo = {
    create: (data: Partial<ComplianceVendorDataAssessmentEntity>) =>
      ({
        id: 0,
        vendorId: 0,
        dataCategory: '',
        classificationLevel: 'INTERNAL',
        allowedDataFieldsJson: '[]',
        prohibitedDataFieldsJson: '[]',
        processingPurpose: '',
        dataFlowDirection: DATA_FLOW_DIRECTION.OUTBOUND,
        storageRegionsJson: '[]',
        crossBorderTransfer: false,
        transferMechanism: null,
        retentionDays: null,
        encryptionInTransit: true,
        encryptionAtRest: true,
        subprocessorsJson: '[]',
        riskLevel: COMPLIANCE_RISK_LEVEL.MEDIUM,
        approvalStatus: ASSESSMENT_APPROVAL_STATUS.PENDING,
        reviewedByUserId: null,
        reviewedAt: null,
        nextReviewDueAt: null,
        notes: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        ...data,
      }) as ComplianceVendorDataAssessmentEntity,
    saveEntity: async (entity: ComplianceVendorDataAssessmentEntity) => {
      if (!entity.id) {
        entity.id = nextId++;
        entity.createdAt = new Date();
        entity.updatedAt = new Date();
        assessments.push(entity);
      } else {
        entity.updatedAt = new Date();
      }
      return entity;
    },
    findById: async (id: number) => assessments.find((a) => a.id === id && !a.deletedAt) ?? null,
    findAll: async () => assessments.filter((a) => !a.deletedAt),
    findByVendorId: async (vendorId: number) =>
      assessments.filter((a) => a.vendorId === vendorId && !a.deletedAt),
    softDeleteEntity: async (entity: ComplianceVendorDataAssessmentEntity) => {
      entity.deletedAt = new Date();
      return entity;
    },
  };

  const settingRegistry = new SettingRegistryService();
  const featureFlagRegistry = new FeatureFlagRegistryService();
  const sequenceRegistry = new SequenceRegistryService();
  const reportRegistry = new ReportRegistryService();
  const exportRegistry = new ExportRegistryService();
  const eventBus = new DomainEventBusService();
  eventBus.registerHandler({
    id: 'compliance.test.observer',
    module: 'compliance',
    eventPattern: '*',
    handler: (ev) => {
      publishedEvents.push(ev.metadata.dotName || ev.type);
    },
  });

  const filesService = {
    ensureActiveFilesExist: async (ids: readonly number[]) =>
      ids.map((id) => ({ id })) as never,
    syncEntityFileUsages: async (params: {
      entityId: string | number;
      fileIds: readonly number[];
    }) => {
      fileUsageCalls.push({ entityId: params.entityId, fileIds: params.fileIds });
    },
  } as unknown as IFilesPublicService;

  const auditPublicService = {
    getAuditLogById: async (id: number) => ({ id, action: 'TEST' }) as never,
  } as unknown as IAuditPublicService;

  const notificationsService = {
    dispatch: async (input: { userId?: number; title?: string }) => {
      dispatchedNotifications.push(input);
      return {} as never;
    },
  } as unknown as INotificationsPublicService;

  const controlService = new ComplianceControlService(
    controlRepo as never,
    checkRepo as never,
    evidenceRepo as never,
    undefined,
    settingRegistry,
    featureFlagRegistry,
    sequenceRegistry,
    eventBus,
  );

  const evidenceService = new ComplianceEvidenceService(
    evidenceRepo as never,
    controlRepo as never,
    checkRepo as never,
    vendorRepo as never,
    filesService,
    auditPublicService,
    undefined,
    settingRegistry,
    featureFlagRegistry,
    eventBus,
  );

  const vendorService = new ComplianceVendorService(
    vendorRepo as never,
    assessmentRepo as never,
    filesService,
    undefined,
    settingRegistry,
    featureFlagRegistry,
    sequenceRegistry,
    eventBus,
  );

  const reportService = new ComplianceReportService(
    controlService,
    evidenceService,
    vendorService,
    undefined,
    settingRegistry,
    featureFlagRegistry,
    reportRegistry,
    exportRegistry,
    eventBus,
  );

  const service = new ComplianceService(
    controlService,
    evidenceService,
    vendorService,
    reportService,
    evidenceRepo as never,
    notificationsService,
    undefined,
    settingRegistry,
    featureFlagRegistry,
    eventBus,
  );

  return {
    service,
    featureFlagRegistry,
    fileUsageCalls,
    dispatchedNotifications,
    publishedEvents,
  };
}

describe('Compliance & Vendor Risk Management Flow (14.6 Feature)', () => {
  const complianceAdmin: UserIdentity = {
    id: 10,
    email: 'security@company.vn',
    roles: ['ADMIN_SECURITY'],
    permissions: [
      COMPLIANCE_PERMISSIONS.READ,
      COMPLIANCE_PERMISSIONS.MANAGE,
      COMPLIANCE_PERMISSIONS.CHECK,
      COMPLIANCE_PERMISSIONS.VENDOR_MANAGE,
      COMPLIANCE_PERMISSIONS.REPORT,
    ],
  };

  const readerWithoutReportPerm: UserIdentity = {
    id: 22,
    email: 'viewer@company.vn',
    roles: ['VIEWER'],
    permissions: [COMPLIANCE_PERMISSIONS.READ],
  };

  let harness: ReturnType<typeof createComplianceTestHarness>;

  beforeEach(() => {
    harness = createComplianceTestHarness();
  });

  it('manages controls, evidences (FILE/LOG/REPORT/LINK) and check histories end-to-end', async () => {
    const control = await harness.service.createControl(
      {
        title: 'Kiểm tra sao lưu định kỳ',
        domain: 'INFRASTRUCTURE',
        frameworkTags: ['ISO27001:A.8.13', 'SOC2:A1.3'],
        ownerUserId: 10,
        frequency: CONTROL_FREQUENCY.MONTHLY,
        status: CONTROL_STATUS.ACTIVE,
      },
      complianceAdmin,
    );

    expect(control.controlCode).toMatch(/^CTRL-/);
    expect(control.nextCheckDueAt).not.toBeNull();

    const fileEvidence = await harness.service.createEvidence(
      {
        controlId: control.id,
        evidenceType: EVIDENCE_TYPE.FILE,
        title: 'Biên bản diễn tập restore',
        fileId: 777,
        evidenceIds: undefined as never,
      } as never,
      complianceAdmin,
    );
    expect(fileEvidence.fileId).toBe(777);
    expect(harness.fileUsageCalls).toContainEqual({
      entityId: fileEvidence.id,
      fileIds: [777],
    });

    const logEvidence = await harness.service.createEvidence(
      {
        controlId: control.id,
        evidenceType: EVIDENCE_TYPE.LOG,
        title: 'Audit log khôi phục',
        auditLogId: 9001,
        logReference: 'backup-restore-job-9001',
        evidenceIds: undefined as never,
      } as never,
      complianceAdmin,
    );
    expect(logEvidence.auditLogId).toBe(9001);

    await expect(
      harness.service.createEvidence(
        {
          controlId: control.id,
          evidenceType: EVIDENCE_TYPE.LINK,
          title: 'Missing URL',
        } as never,
        complianceAdmin,
      ),
    ).rejects.toThrow(BadRequestAppException);

    const check = await harness.service.recordControlCheck(
      control.id,
      {
        result: CONTROL_CHECK_RESULT.PASS,
        score: 96,
        findings: 'Restore thành công trong 12 phút.',
        evidenceIds: [fileEvidence.id, logEvidence.id],
      },
      complianceAdmin,
    );
    expect(check.checkedByUserId).toBe(10);
    expect(check.evidenceIds).toEqual([fileEvidence.id, logEvidence.id]);

    const updatedControl = await harness.service.getControlById(control.id);
    expect(updatedControl.lastCheckResult).toBe(CONTROL_CHECK_RESULT.PASS);
    expect(updatedControl.lastCheckedAt).not.toBeNull();

    // Deleting file evidence detaches file usage
    await harness.service.deleteEvidence(fileEvidence.id, complianceAdmin);
    expect(harness.fileUsageCalls).toContainEqual({
      entityId: fileEvidence.id,
      fileIds: [],
    });
  });

  it('manages vendors (Email/SMS/Cloud/Payment/AI), data assessments, fallback plans, and reminder sweeps', async () => {
    const soonDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
    const pastDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

    const aiVendor = await harness.service.createVendor(
      {
        name: 'Gemini Enterprise AI',
        category: VENDOR_CATEGORY.AI,
        criticality: COMPLIANCE_RISK_LEVEL.HIGH,
        status: VENDOR_STATUS.ACTIVE,
        ownerUserId: 10,
        contractEndDate: soonDate,
        autoRenew: false,
        reviewFrequency: CONTROL_FREQUENCY.QUARTERLY,
        nextReviewDueAt: pastDate,
        dpaSigned: true,
        fallbackVendorName: 'Self-hosted vLLM Gateway',
        fallbackStrategy: 'Fallback sang cụm LLM nội bộ qua AI Adapter.',
        rtoHours: 4,
      },
      complianceAdmin,
    );
    expect(aiVendor.vendorCode).toMatch(/^VEND-/);
    expect(aiVendor.hasFallbackPlan).toBe(true);

    const smsVendorWithoutFallback = await harness.service.createVendor(
      {
        name: 'Legacy SMS Provider',
        category: VENDOR_CATEGORY.SMS,
        criticality: COMPLIANCE_RISK_LEVEL.MEDIUM,
        status: VENDOR_STATUS.ACTIVE,
        autoRenew: false,
        reviewFrequency: CONTROL_FREQUENCY.SEMI_ANNUAL,
        dpaSigned: false,
      },
      complianceAdmin,
    );
    expect(smsVendorWithoutFallback.hasFallbackPlan).toBe(false);

    const assessment = await harness.service.createVendorDataAssessment(
      aiVendor.id,
      {
        dataCategory: 'Support Ticket Summaries',
        classificationLevel: 'CONFIDENTIAL',
        allowedDataFields: ['anonymizedSummary', 'ticketCategory'],
        prohibitedDataFields: ['passwordHash', 'identityNumber', 'bankAccountNumber'],
        processingPurpose: 'Tóm tắt phân loại ticket hỗ trợ',
        dataFlowDirection: DATA_FLOW_DIRECTION.BIDIRECTIONAL,
        storageRegions: ['asia-southeast1'],
        crossBorderTransfer: true,
        transferMechanism: 'Zero Data Retention + DPA',
        retentionDays: 0,
        encryptionInTransit: true,
        encryptionAtRest: true,
        subprocessors: [],
        riskLevel: COMPLIANCE_RISK_LEVEL.HIGH,
        approvalStatus: ASSESSMENT_APPROVAL_STATUS.APPROVED,
      },
      complianceAdmin,
    );
    expect(assessment.crossBorderTransfer).toBe(true);
    expect(assessment.prohibitedDataFields).toContain('identityNumber');

    const ctrl = await harness.service.createControl(
      {
        title: 'Expired Evidence Control',
        domain: 'VENDOR',
        frameworkTags: ['GDPR:Art.28'],
        ownerUserId: 10,
        frequency: CONTROL_FREQUENCY.QUARTERLY,
        status: CONTROL_STATUS.ACTIVE,
        nextCheckDueAt: pastDate,
      },
      complianceAdmin,
    );

    const expiredEvidence = await harness.service.createEvidence(
      {
        controlId: ctrl.id,
        vendorId: aiVendor.id,
        evidenceType: EVIDENCE_TYPE.LINK,
        title: 'SOC2 Type II Certificate',
        externalUrl: 'https://trust.example.com/soc2',
        validUntil: pastDate,
      },
      complianceAdmin,
    );
    expect(expiredEvidence.status).toBe(EVIDENCE_STATUS.EXPIRED);

    const sweep = await harness.service.runReviewReminderSweep({ dryRun: false });
    expect(sweep.controlsDueOrOverdue).toBeGreaterThanOrEqual(1);
    expect(sweep.vendorReviewsDueOrOverdue).toBeGreaterThanOrEqual(1);
    expect(sweep.contractsExpiringOrExpired).toBeGreaterThanOrEqual(1);
    expect(sweep.notificationsDispatched).toBeGreaterThanOrEqual(2);
    expect(harness.publishedEvents).toContain('compliance.contract.expiring');
    expect(harness.publishedEvents).toContain('compliance.review.due');
  });

  it('generates framework-agnostic compliance reports with distinct permission and export artifacts', async () => {
    await harness.service.createControl(
      {
        title: 'Control A (ISO + SOC2)',
        domain: 'ACCESS',
        frameworkTags: ['ISO27001:A.5', 'SOC2:CC6'],
        frequency: CONTROL_FREQUENCY.QUARTERLY,
        status: CONTROL_STATUS.ACTIVE,
      },
      complianceAdmin,
    );
    await harness.service.createControl(
      {
        title: 'Control B (Custom Internal)',
        domain: 'OPERATIONS',
        frameworkTags: ['INTERNAL:OPS-01'],
        frequency: CONTROL_FREQUENCY.MONTHLY,
        status: CONTROL_STATUS.ACTIVE,
      },
      complianceAdmin,
    );

    // Distinct report permission check
    await expect(
      harness.service.generateReport(
        { format: 'json', includeControls: true, includeVendors: true },
        readerWithoutReportPerm,
      ),
    ).rejects.toThrow(ForbiddenAppException);

    // Filter by specific framework tag
    const isoReport = await harness.service.generateReport(
      {
        frameworkTag: 'ISO27001',
        includeControls: true,
        includeVendors: true,
        format: 'csv',
      },
      complianceAdmin,
    );
    expect(isoReport.summary.totalControls).toBe(1);
    expect(isoReport.downloadToken).toBeTruthy();

    const downloaded = harness.service.downloadReportArtifact(isoReport.downloadToken!);
    expect(downloaded.format).toBe('csv');
    expect(downloaded.csvContent).toContain('Control A');

    // Without framework filter -> includes all controls regardless of standard
    const allReport = await harness.service.generateReport(
      {
        includeControls: true,
        includeVendors: true,
        format: 'json',
      },
      complianceAdmin,
    );
    expect(allReport.summary.totalControls).toBe(2);

    // Feature flag disabling blocks module access
    harness.featureFlagRegistry.upsertDefinition({
      key: COMPLIANCE_FEATURE_FLAGS.ENABLED,
      module: 'compliance',
      name: 'Compliance Enabled',
      description: 'Disable compliance for test',
      isEnabled: false,
      rolloutPercentage: 100,
      targetUserIds: [],
      targetRoles: [],
      targetOrganizationUnitIds: [],
      startsAt: null,
      endsAt: null,
      metadata: null,
      isSystem: true,
      status: 1,
      updatedBy: null,
      updatedAt: new Date().toISOString(),
    });
    await expect(harness.service.getOverview()).rejects.toThrow(ForbiddenAppException);
  });
});

import { beforeEach, describe, expect, it } from '@jest/globals';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  BadRequestAppException,
  ConflictAppException,
  DataGovernanceHookRegistry,
  DomainEventBusService,
  FeatureFlagRegistryService,
  ForbiddenAppException,
  SequenceRegistryService,
  SettingRegistryService,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type { IAuditPublicService } from '../../../src/modules/audit/contracts/index.js';
import type { DataClassificationEntity } from '../../../src/modules/data-governance/entities/data-classification.entity.js';
import type { DataLegalHoldEntity } from '../../../src/modules/data-governance/entities/data-legal-hold.entity.js';
import type { DataSensitiveFieldEntity } from '../../../src/modules/data-governance/entities/data-sensitive-field.entity.js';
import type { PrivacyConsentDefinitionEntity } from '../../../src/modules/data-governance/entities/privacy-consent-definition.entity.js';
import type { PrivacyDsarRequestEntity } from '../../../src/modules/data-governance/entities/privacy-dsar-request.entity.js';
import type { PrivacyUserConsentEntity } from '../../../src/modules/data-governance/entities/privacy-user-consent.entity.js';
import {
  CONSENT_STATUS,
  DSAR_STATUS,
  LEGAL_HOLD_STATUS,
} from '../../../src/modules/data-governance/enum/data-governance.enum.js';
import { ConsentManagementService } from '../../../src/modules/data-governance/services/consent-management.service.js';
import { DataClassificationService } from '../../../src/modules/data-governance/services/data-classification.service.js';
import { DataGovernanceService } from '../../../src/modules/data-governance/services/data-governance.service.js';
import { DsarService } from '../../../src/modules/data-governance/services/dsar.service.js';
import { LegalHoldService } from '../../../src/modules/data-governance/services/legal-hold.service.js';
import { PersonalDataContributorsService } from '../../../src/modules/data-governance/services/personal-data-contributors.service.js';
import type { IExportsPublicService } from '../../../src/modules/exports/contracts/index.js';
import type { ISessionsPublicService } from '../../../src/modules/sessions/contracts/index.js';
import {
  USER_STATUS,
  type IUsersPublicService,
} from '../../../src/modules/users/contracts/index.js';

function createGovernanceTestHarness() {
  let nextId = 1;
  const classifications: DataClassificationEntity[] = [];
  const sensitiveFields: DataSensitiveFieldEntity[] = [];
  const dsarRequests: PrivacyDsarRequestEntity[] = [];
  const consentDefs: PrivacyConsentDefinitionEntity[] = [];
  const userConsents: PrivacyUserConsentEntity[] = [];
  const legalHolds: DataLegalHoldEntity[] = [];

  const usersState = new Map<
    number,
    {
      id: number;
      username: string;
      email: string;
      phone: string | null;
      firstName: string;
      lastName: string;
      fullName: string;
      anonymized: boolean;
    }
  >([
    [
      42,
      {
        id: 42,
        username: 'le_thi_hoa',
        email: 'hoa.le@company.vn',
        phone: '0912345678',
        firstName: 'Hoa',
        lastName: 'Lê Thị',
        fullName: 'Lê Thị Hoa',
        anonymized: false,
      },
    ],
  ]);

  let activeSessionsFor42 = 3;
  const exportHistories = [
    {
      id: 501,
      jobId: 'exp_501',
      profileCode: 'users',
      module: 'users',
      fileName: 'old_export.csv',
      format: 'csv' as const,
      status: 'COMPLETED' as const,
      actorId: 42,
      filters: {},
      totalExported: 12,
      processedRows: 12,
      maxRowsApplied: 5000,
      isExpired: true,
      downloadToken: null,
      downloadUrl: null,
      expiresAt: null,
      notifiedAt: null,
      errorMessage: null,
      createdAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
      completedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
    },
  ];

  const hookRegistry = new DataGovernanceHookRegistry();
  const settingRegistry = new SettingRegistryService();
  const featureFlagRegistry = new FeatureFlagRegistryService();
  const sequenceRegistry = new SequenceRegistryService();
  const eventBus = new DomainEventBusService();

  const classificationRepo = {
    create: (d: Partial<DataClassificationEntity>) =>
      ({
        id: nextId++,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastEnforcedAt: null,
        ...d,
      }) as DataClassificationEntity,
    saveEntity: async (e: DataClassificationEntity) => {
      e.updatedAt = new Date();
      const idx = classifications.findIndex((x) => x.id === e.id);
      if (idx >= 0) classifications[idx] = e;
      else classifications.push(e);
      return e;
    },
    findById: async (id: number) => classifications.find((x) => x.id === id) ?? null,
    findByCode: async (code: string) =>
      classifications.find((x) => x.dataTypeCode === code) ?? null,
    findAll: async () => [...classifications],
    findAllEnabled: async () => classifications.filter((x) => x.isEnabled),
    paginateFiltered: async (f: { page?: number; limit?: number }) =>
      createPaginatedResult(classifications, classifications.length, f.page ?? 1, f.limit ?? 50),
  };

  const sensitiveFieldRepo = {
    create: (d: Partial<DataSensitiveFieldEntity>) =>
      ({
        id: nextId++,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...d,
      }) as DataSensitiveFieldEntity,
    saveEntity: async (e: DataSensitiveFieldEntity) => {
      const idx = sensitiveFields.findIndex((x) => x.id === e.id);
      if (idx >= 0) sensitiveFields[idx] = e;
      else sensitiveFields.push(e);
      return e;
    },
    findById: async (id: number) => sensitiveFields.find((x) => x.id === id) ?? null,
    findByResourceAndPath: async (res: string, p: string) =>
      sensitiveFields.find((x) => x.resourceType === res && x.fieldPath === p) ?? null,
    findAll: async () => [...sensitiveFields],
    findAllEnabled: async () => sensitiveFields.filter((x) => x.isEnabled),
    paginateFiltered: async (f: { page?: number; limit?: number }) =>
      createPaginatedResult(sensitiveFields, sensitiveFields.length, f.page ?? 1, f.limit ?? 50),
  };

  const dsarRepo = {
    create: (d: Partial<PrivacyDsarRequestEntity>) =>
      ({
        id: nextId++,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...d,
      }) as PrivacyDsarRequestEntity,
    saveEntity: async (e: PrivacyDsarRequestEntity) => {
      e.updatedAt = new Date();
      const idx = dsarRequests.findIndex((x) => x.id === e.id);
      if (idx >= 0) dsarRequests[idx] = e;
      else dsarRequests.push(e);
      return e;
    },
    findById: async (id: number) => dsarRequests.find((x) => x.id === id) ?? null,
    findByExportToken: async (tok: string) =>
      dsarRequests.find((x) => x.exportToken === tok) ?? null,
    findExpiredExportTokens: async (now: Date) =>
      dsarRequests.filter(
        (x) => x.exportToken !== null && x.exportExpiresAt !== null && x.exportExpiresAt <= now,
      ),
    countByStatuses: async () => ({
      pending: dsarRequests.filter(
        (x) => x.status === DSAR_STATUS.PENDING || x.status === DSAR_STATUS.PENDING_APPROVAL,
      ).length,
      pendingApprovalErasure: dsarRequests.filter(
        (x) => x.requestType === 'ERASURE' && x.status === DSAR_STATUS.PENDING_APPROVAL,
      ).length,
    }),
    paginateFiltered: async (f: { subjectUserId?: number; page?: number; limit?: number }) => {
      const items =
        f.subjectUserId !== undefined
          ? dsarRequests.filter((x) => x.subjectUserId === f.subjectUserId)
          : [...dsarRequests];
      return createPaginatedResult(items, items.length, f.page ?? 1, f.limit ?? 25);
    },
  };

  const consentDefRepo = {
    create: (d: Partial<PrivacyConsentDefinitionEntity>) =>
      ({
        id: nextId++,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...d,
      }) as PrivacyConsentDefinitionEntity,
    saveEntity: async (e: PrivacyConsentDefinitionEntity) => {
      const idx = consentDefs.findIndex((x) => x.id === e.id);
      if (idx >= 0) consentDefs[idx] = e;
      else consentDefs.push(e);
      return e;
    },
    findByPurposeAndVersion: async (p: string, v: string) =>
      consentDefs.find((x) => x.purposeCode === p && x.policyVersion === v) ?? null,
    findLatestActiveByPurpose: async (p: string) =>
      [...consentDefs].reverse().find((x) => x.purposeCode === p && x.isActive) ?? null,
    findAllActive: async () => consentDefs.filter((x) => x.isActive),
    paginateFiltered: async (f: { page?: number; limit?: number }) =>
      createPaginatedResult(consentDefs, consentDefs.length, f.page ?? 1, f.limit ?? 50),
  };

  const userConsentRepo = {
    create: (d: Partial<PrivacyUserConsentEntity>) =>
      ({
        id: nextId++,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...d,
      }) as PrivacyUserConsentEntity,
    saveEntity: async (e: PrivacyUserConsentEntity) => {
      e.updatedAt = new Date();
      const idx = userConsents.findIndex((x) => x.id === e.id);
      if (idx >= 0) userConsents[idx] = e;
      else userConsents.push(e);
      return e;
    },
    findByUserId: async (uid: number) => userConsents.filter((x) => x.userId === uid),
    findLatestGrantedByUserAndPurpose: async (uid: number, p: string) =>
      [...userConsents]
        .reverse()
        .find(
          (x) =>
            x.userId === uid && x.purposeCode === p && x.consentStatus === CONSENT_STATUS.GRANTED,
        ) ?? null,
    findExpiredGrantedConsents: async (now: Date) =>
      userConsents.filter(
        (x) =>
          x.consentStatus === CONSENT_STATUS.GRANTED && x.expiresAt !== null && x.expiresAt <= now,
      ),
    findWithdrawnBeforeCutoff: async (cutoff: Date) =>
      userConsents.filter(
        (x) =>
          (x.consentStatus === CONSENT_STATUS.WITHDRAWN ||
            x.consentStatus === CONSENT_STATUS.EXPIRED) &&
          x.updatedAt <= cutoff,
      ),
    softRemoveEntity: async (e: PrivacyUserConsentEntity) => {
      const idx = userConsents.findIndex((x) => x.id === e.id);
      if (idx >= 0) userConsents.splice(idx, 1);
      return e;
    },
    paginateFiltered: async (f: { page?: number; limit?: number }) =>
      createPaginatedResult(userConsents, userConsents.length, f.page ?? 1, f.limit ?? 50),
  };

  const legalHoldRepo = {
    create: (d: Partial<DataLegalHoldEntity>) =>
      ({ id: nextId++, createdAt: new Date(), updatedAt: new Date(), ...d }) as DataLegalHoldEntity,
    saveEntity: async (e: DataLegalHoldEntity) => {
      e.updatedAt = new Date();
      const idx = legalHolds.findIndex((x) => x.id === e.id);
      if (idx >= 0) legalHolds[idx] = e;
      else legalHolds.push(e);
      return e;
    },
    findById: async (id: number) => legalHolds.find((x) => x.id === id) ?? null,
    findAllActive: async () => legalHolds.filter((x) => x.holdStatus === LEGAL_HOLD_STATUS.ACTIVE),
    findExpiredActiveHolds: async (now: Date) =>
      legalHolds.filter(
        (x) =>
          x.holdStatus === LEGAL_HOLD_STATUS.ACTIVE && x.expiresAt !== null && x.expiresAt <= now,
      ),
    paginateFiltered: async (f: { page?: number; limit?: number }) =>
      createPaginatedResult(legalHolds, legalHolds.length, f.page ?? 1, f.limit ?? 25),
  };

  const mockUsersService: Partial<IUsersPublicService> = {
    findAuthUserById: async (uid: number) => {
      const u = usersState.get(uid);
      if (!u) return null;
      return {
        id: u.id,
        username: u.username,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        fullName: u.fullName,
        phone: u.phone,
        status: USER_STATUS.ACTIVE,
        statusName: 'ACTIVE',
        lockedUntil: null,
        mfaEnabled: false,
        primaryOrganizationUnitId: 1,
        organizationUnitIds: [1],
        roles: ['employee'],
        permissions: [],
      };
    },
    anonymizePersonalData: async (uid: number) => {
      const u = usersState.get(uid);
      if (!u) return { anonymized: false, fieldsCleared: [] };
      u.email = `erased.${uid}@anonymized.local`;
      u.phone = null;
      u.firstName = 'Anonymized';
      u.lastName = `User#${uid}`;
      u.fullName = `Anonymized User #${uid}`;
      u.anonymized = true;
      return { anonymized: true, fieldsCleared: ['email', 'phone', 'fullName'] };
    },
  };

  const mockSessionsService: Partial<ISessionsPublicService> = {
    listUserSessions: async () =>
      Array.from({ length: activeSessionsFor42 }, (_, idx) => ({
        id: idx + 1,
        userId: 42,
        deviceName: 'Chrome Linux',
        ipAddress: '10.0.0.1',
        userAgent: 'Mozilla/5.0',
        lastActiveAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        createdAt: new Date().toISOString(),
        isCurrent: idx === 0,
      })),
    listUserLoginHistory: async () => [],
    revokeAllUserSessions: async () => {
      const count = activeSessionsFor42;
      activeSessionsFor42 = 0;
      return count;
    },
  };

  const mockAuditService: Partial<IAuditPublicService> = {
    listAuditLogs: async () => ({
      data: [
        {
          id: 9001,
          actorType: 1,
          actorTypeName: 'USER',
          actorUserId: 42,
          actorServiceAccountId: null,
          actorApiClientId: null,
          actorIdentifier: 'hoa.le@company.vn',
          module: 'users',
          feature: 'profile',
          action: 'UPDATE',
          resourceType: 'user',
          resourceId: '42',
          reason: null,
          beforeData: null,
          afterData: null,
          ipAddress: '10.0.0.1',
          userAgent: null,
          requestId: 'req-1',
          correlationId: 'corr-1',
          createdAt: new Date().toISOString(),
        },
      ],
      meta: { page: 1, limit: 50, totalItems: 2, totalPages: 1 },
    }),
  };

  const mockExportsService: Partial<IExportsPublicService> = {
    listHistories: async () => [...exportHistories],
    deleteHistory: async (id: number) => {
      const idx = exportHistories.findIndex((h) => h.id === id);
      if (idx >= 0) exportHistories.splice(idx, 1);
      return { deleted: true, id };
    },
  };

  const classificationService = new DataClassificationService(
    classificationRepo as never,
    sensitiveFieldRepo as never,
    undefined,
    hookRegistry,
    settingRegistry,
    featureFlagRegistry,
    eventBus,
  );

  const legalHoldService = new LegalHoldService(
    legalHoldRepo as never,
    undefined,
    settingRegistry,
    featureFlagRegistry,
    sequenceRegistry,
    eventBus,
  );

  const consentService = new ConsentManagementService(
    consentDefRepo as never,
    userConsentRepo as never,
    undefined,
    settingRegistry,
    featureFlagRegistry,
    eventBus,
  );

  const contributorsService = new PersonalDataContributorsService(
    consentService,
    mockUsersService as IUsersPublicService,
    mockSessionsService as ISessionsPublicService,
    mockAuditService as IAuditPublicService,
    undefined,
    mockExportsService as IExportsPublicService,
    hookRegistry,
  );

  const dsarService = new DsarService(
    dsarRepo as never,
    classificationRepo as never,
    legalHoldService,
    undefined,
    hookRegistry,
    settingRegistry,
    featureFlagRegistry,
    sequenceRegistry,
    eventBus,
  );

  const governanceService = new DataGovernanceService(
    classificationService,
    dsarService,
    consentService,
    legalHoldService,
    hookRegistry,
    settingRegistry,
    featureFlagRegistry,
  );

  hookRegistry.registerSensitiveFieldEvaluator(classificationService);
  hookRegistry.registerLegalHoldGuard(legalHoldService);
  contributorsService.registerBuiltinContributorsAndRetention();

  return {
    governanceService,
    legalHoldService,
    usersState,
    exportHistories,
    getActiveSessionsFor42: () => activeSessionsFor42,
  };
}

describe('Data Privacy & Governance End-to-End Flow Tests (Section 14.5)', () => {
  const subjectUser: UserIdentity = {
    id: 42,
    username: 'le_thi_hoa',
    email: 'hoa.le@company.vn',
    roles: ['employee'],
    permissions: ['data-governance.dsar.request'],
  };

  const dpoOfficer: UserIdentity = {
    id: 3,
    username: 'dpo_officer',
    email: 'dpo@company.vn',
    roles: ['admin_security'],
    permissions: [
      'data-governance.read',
      'data-governance.manage',
      'data-governance.sensitive.read',
      'data-governance.dsar.approve',
      'data-governance.consent.manage',
      'data-governance.legal_hold.manage',
    ],
  };

  const anotherEmployee: UserIdentity = {
    id: 99,
    username: 'other_user',
    email: 'other@company.vn',
    roles: ['employee'],
    permissions: [],
  };

  let harness: ReturnType<typeof createGovernanceTestHarness>;

  beforeEach(async () => {
    harness = createGovernanceTestHarness();

    await harness.governanceService.upsertClassification(
      {
        dataTypeCode: 'public.catalog',
        displayName: 'Public Catalog',
        moduleName: 'codes',
        classificationLevel: 'PUBLIC',
        containsPii: false,
        retentionDays: 0,
        retentionAction: 'ARCHIVE',
        isEnabled: true,
      },
      dpoOfficer,
    );
    await harness.governanceService.upsertClassification(
      {
        dataTypeCode: 'exports.artifacts',
        displayName: 'Export Artifacts',
        moduleName: 'exports',
        classificationLevel: 'INTERNAL',
        containsPii: false,
        retentionDays: 30,
        retentionAction: 'PURGE',
        isEnabled: true,
      },
      dpoOfficer,
    );
    await harness.governanceService.upsertClassification(
      {
        dataTypeCode: 'users.personal_profile',
        displayName: 'Personal Profile',
        moduleName: 'users',
        classificationLevel: 'CONFIDENTIAL',
        containsPii: true,
        retentionDays: 1095,
        retentionAction: 'ANONYMIZE',
        isEnabled: true,
      },
      dpoOfficer,
    );
    await harness.governanceService.upsertClassification(
      {
        dataTypeCode: 'audit.logs',
        displayName: 'Immutable Audit Logs',
        moduleName: 'audit',
        classificationLevel: 'RESTRICTED',
        containsPii: true,
        retentionDays: 2555,
        retentionAction: 'RETAIN_LEGAL',
        isEnabled: true,
      },
      dpoOfficer,
    );
  });

  it('manages 4-tier Data Classifications & User Consents (purpose, version, timestamp, mandatory guard)', async () => {
    const overview = await harness.governanceService.getOverview();
    expect(overview.counts.classificationsTotal).toBe(4);
    expect(overview.counts.classificationsByLevel).toEqual({
      PUBLIC: 1,
      INTERNAL: 1,
      CONFIDENTIAL: 1,
      RESTRICTED: 1,
    });

    await harness.governanceService.upsertConsentDefinition(
      {
        purposeCode: 'core_account',
        policyVersion: '1.0',
        title: 'Core Account Service',
        description: 'Mandatory account operation consent',
        classificationLevel: 'CONFIDENTIAL',
        isMandatory: true,
        isActive: true,
      },
      dpoOfficer,
    );
    await harness.governanceService.upsertConsentDefinition(
      {
        purposeCode: 'marketing_newsletter',
        policyVersion: '2.1',
        title: 'Marketing Newsletter',
        description: 'Optional marketing consent',
        classificationLevel: 'INTERNAL',
        isMandatory: false,
        validityDays: 365,
        isActive: true,
      },
      dpoOfficer,
    );

    const grantedMandatory = await harness.governanceService.grantConsent(
      { purposeCode: 'core_account', collectionSource: 'PORTAL' },
      subjectUser,
      { ipAddress: '203.0.113.10', userAgent: 'Chrome/130' },
    );
    expect(grantedMandatory.policyVersion).toBe('1.0');
    expect(grantedMandatory.consentStatus).toBe('GRANTED');

    const grantedMarketing = await harness.governanceService.grantConsent(
      { purposeCode: 'marketing_newsletter', collectionSource: 'MOBILE_APP' },
      subjectUser,
      { ipAddress: '203.0.113.10', userAgent: 'MobileSafari' },
    );
    expect(grantedMarketing.policyVersion).toBe('2.1');
    expect(grantedMarketing.expiresAt).not.toBeNull();

    // Mandatory consent cannot be withdrawn directly
    await expect(
      harness.governanceService.withdrawConsent(
        { purposeCode: 'core_account', reason: 'Stop service' },
        subjectUser,
      ),
    ).rejects.toBeInstanceOf(BadRequestAppException);

    // Optional consent can be withdrawn with timestamp & reason
    const withdrawn = await harness.governanceService.withdrawConsent(
      { purposeCode: 'marketing_newsletter', reason: 'Unsubscribe' },
      subjectUser,
    );
    expect(withdrawn.consentStatus).toBe('WITHDRAWN');
    expect(withdrawn.withdrawnAt).not.toBeNull();
  });

  it('aggregates cross-module personal data for DSAR ACCESS and generates machine-readable JSON & CSV exports', async () => {
    await harness.governanceService.upsertConsentDefinition(
      {
        purposeCode: 'analytics',
        policyVersion: '1.0',
        title: 'Analytics',
        description: 'Usage analytics',
        classificationLevel: 'INTERNAL',
        isMandatory: false,
        isActive: true,
      },
      dpoOfficer,
    );
    await harness.governanceService.grantConsent(
      { purposeCode: 'analytics', collectionSource: 'PORTAL' },
      subjectUser,
    );

    // 1. DSAR ACCESS
    const accessReq = await harness.governanceService.createDsarRequest(
      { requestType: 'ACCESS', reason: 'Kiểm tra thông tin cá nhân đang lưu' },
      subjectUser,
    );
    expect(accessReq.status).toBe(DSAR_STATUS.COMPLETED);
    const summary = accessReq.summary as { totalModules: number; totalRecords: number };
    expect(summary.totalModules).toBeGreaterThanOrEqual(4);
    expect(summary.totalRecords).toBeGreaterThanOrEqual(5);

    // 2. DSAR EXPORT (JSON)
    const jsonExportReq = await harness.governanceService.createDsarRequest(
      { requestType: 'EXPORT', exportFormat: 'json' },
      subjectUser,
    );
    expect(jsonExportReq.downloadUrl).toContain('/api/v1/data-governance/dsar/downloads/');
    const jsonToken = jsonExportReq.downloadUrl!.split('/').pop()!;

    // Unauthorized user cannot download someone else's personal data export
    await expect(
      harness.governanceService.downloadDsarExport(jsonToken, anotherEmployee),
    ).rejects.toBeInstanceOf(ForbiddenAppException);

    const downloadedJson = await harness.governanceService.downloadDsarExport(
      jsonToken,
      subjectUser,
    );
    expect(downloadedJson.contentType).toContain('application/json');
    const parsedPackage = JSON.parse(downloadedJson.content) as {
      subjectUserId: number;
      sections: Array<{ dataTypeCode: string; recordCount: number }>;
    };
    expect(parsedPackage.subjectUserId).toBe(42);
    expect(parsedPackage.sections.some((s) => s.dataTypeCode === 'users.personal_profile')).toBe(
      true,
    );

    // 3. DSAR EXPORT (CSV)
    const csvExportReq = await harness.governanceService.createDsarRequest(
      { requestType: 'EXPORT', exportFormat: 'csv' },
      subjectUser,
    );
    const csvToken = csvExportReq.downloadUrl!.split('/').pop()!;
    const downloadedCsv = await harness.governanceService.downloadDsarExport(csvToken, subjectUser);
    expect(downloadedCsv.contentType).toContain('text/csv');
    expect(downloadedCsv.content).toContain('users.personal_profile');
    expect(downloadedCsv.content).toContain('hoa.le@company.vn');
  });

  it('enforces Legal Hold against DSAR Erasure & Retention Sweep, then executes approved Erasure with exceptions after release', async () => {
    // 1. Place Legal Hold on User #42
    const hold = await harness.governanceService.createLegalHold(
      {
        title: 'Tạm giữ điều tra tranh chấp hợp đồng #2026-88',
        caseReference: 'CASE-2026-88',
        reason: 'Yêu cầu giữ nguyên toàn bộ hồ sơ và lịch sử xuất dữ liệu',
        scopeType: 'USER',
        targetUserId: 42,
      },
      dpoOfficer,
    );
    expect(hold.holdStatusName).toBe('ACTIVE');

    // 2. Retention Sweep skips User #42's expired export history due to active Legal Hold
    const sweepWhileHeld = await harness.governanceService.runRetentionSweep({
      dataTypeCode: 'exports.artifacts',
      dryRun: false,
      actor: dpoOfficer,
    });
    const exportPolicyRes = sweepWhileHeld.results.find(
      (r) => r.dataTypeCode === 'exports.artifacts',
    )!;
    expect(exportPolicyRes.skippedLegalHoldCount).toBe(1);
    expect(exportPolicyRes.affectedCount).toBe(0);
    expect(harness.exportHistories.length).toBe(1);

    // 3. Subject submits DSAR ERASURE request -> goes to PENDING_APPROVAL
    const erasureReq = await harness.governanceService.createDsarRequest(
      {
        requestType: 'ERASURE',
        reason: 'Ngừng sử dụng dịch vụ, yêu cầu xóa dữ liệu cá nhân',
      },
      subjectUser,
    );
    expect(erasureReq.status).toBe(DSAR_STATUS.PENDING_APPROVAL);

    // Self-approval is forbidden
    await expect(
      harness.governanceService.approveDsarRequest(erasureReq.id, {}, subjectUser),
    ).rejects.toBeInstanceOf(ForbiddenAppException);

    // DPO attempts to approve while Legal Hold is ACTIVE -> blocked with 409 Conflict & marked BLOCKED_LEGAL_HOLD
    await expect(
      harness.governanceService.approveDsarRequest(
        erasureReq.id,
        { comment: 'Thử duyệt khi đang bị Legal Hold' },
        dpoOfficer,
      ),
    ).rejects.toBeInstanceOf(ConflictAppException);

    const blockedView = await harness.governanceService.getDsarRequestById(
      erasureReq.id,
      dpoOfficer,
    );
    expect(blockedView.status).toBe(DSAR_STATUS.BLOCKED_LEGAL_HOLD);
    expect(harness.usersState.get(42)?.anonymized).toBe(false);

    // 4. Release Legal Hold
    const released = await harness.governanceService.releaseLegalHold(
      hold.id,
      { reason: 'Đã kết thúc điều tra vụ việc CASE-2026-88' },
      dpoOfficer,
    );
    expect(released.holdStatusName).toBe('RELEASED');

    // 5. DPO approves DSAR ERASURE with explicit exception + immutable audit.logs exception
    const completedErasure = await harness.governanceService.approveDsarRequest(
      erasureReq.id,
      {
        comment: 'Đồng ý ẩn danh hồ sơ, giữ lại nhật ký kiểm toán và chứng từ xuất theo quy định',
        excludedDataTypeCodes: ['exports.artifacts'],
      },
      dpoOfficer,
    );

    expect(completedErasure.status).toBe(DSAR_STATUS.PARTIALLY_COMPLETED);
    expect(harness.usersState.get(42)?.anonymized).toBe(true);
    expect(harness.usersState.get(42)?.email).toContain('@anonymized.local');
    expect(harness.getActiveSessionsFor42()).toBe(0);
    expect(completedErasure.retainedExceptions.some((e) => e.dataTypeCode === 'audit.logs')).toBe(
      true,
    );
    expect(
      completedErasure.retainedExceptions.some((e) => e.dataTypeCode === 'exports.artifacts'),
    ).toBe(true);

    // 6. Now that Legal Hold is released, Retention Sweep purges the expired export history
    const sweepAfterRelease = await harness.governanceService.runRetentionSweep({
      dataTypeCode: 'exports.artifacts',
      dryRun: false,
      actor: dpoOfficer,
    });
    expect(sweepAfterRelease.results[0]?.affectedCount).toBe(1);
    expect(harness.exportHistories.length).toBe(0);
  });
});

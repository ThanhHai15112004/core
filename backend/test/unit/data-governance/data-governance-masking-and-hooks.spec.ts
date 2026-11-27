import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  DataGovernanceHookRegistry,
  ExportRegistryService,
  FeatureFlagRegistryService,
  ForbiddenAppException,
  SettingRegistryService,
} from '@packages/kernel/index.js';
import {
  configureDynamicSensitiveKeys,
  configureExtraSensitiveKeys,
  redactSensitiveData,
} from '@packages/logging/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type { DataClassificationEntity } from '../../../src/modules/data-governance/entities/data-classification.entity.js';
import type { DataSensitiveFieldEntity } from '../../../src/modules/data-governance/entities/data-sensitive-field.entity.js';
import { DataClassificationService } from '../../../src/modules/data-governance/services/data-classification.service.js';
import { ExportsService } from '../../../src/modules/exports/services/exports.service.js';

describe('Data Governance Sensitive Masking, Log Redaction & Export Hook Unit Tests (14.5)', () => {
  let hookRegistry: DataGovernanceHookRegistry;
  let settingRegistry: SettingRegistryService;
  let featureFlagRegistry: FeatureFlagRegistryService;
  let classificationService: DataClassificationService;
  let storedFields: DataSensitiveFieldEntity[];
  let storedClassifications: DataClassificationEntity[];

  const regularStaff: UserIdentity = {
    id: 25,
    username: 'staff_hr',
    email: 'staff@example.com',
    roles: ['staff'],
    permissions: ['users.export', 'data-governance.read'],
  };

  const dpoAdmin: UserIdentity = {
    id: 3,
    username: 'dpo_admin',
    email: 'dpo@example.com',
    roles: ['admin_security'],
    permissions: [
      'users.export',
      'data-governance.read',
      'data-governance.manage',
      'data-governance.sensitive.read',
    ],
  };

  beforeEach(async () => {
    let seq = 1;
    storedFields = [];
    storedClassifications = [];
    hookRegistry = new DataGovernanceHookRegistry();
    settingRegistry = new SettingRegistryService();
    featureFlagRegistry = new FeatureFlagRegistryService();
    featureFlagRegistry.upsertDefinition({
      key: 'data-governance.enabled',
      module: 'data-governance',
      name: 'Enable Data Governance',
      description: 'Toggle 14.5',
      isEnabled: true,
      rolloutPercentage: 100,
      targetUserIds: [],
      targetRoles: [],
      targetOrganizationUnitIds: [],
      startsAt: null,
      endsAt: null,
      metadata: null,
      isSystem: true,
      status: 1,
    });

    hookRegistry.registerLogRedactSyncListener((extraKeys) => {
      configureDynamicSensitiveKeys(extraKeys);
    });

    const mockClassificationRepo = {
      findByCode: async (code: string) =>
        storedClassifications.find((c) => c.dataTypeCode === code) ?? null,
      findAll: async () => [...storedClassifications],
      findAllEnabled: async () => storedClassifications.filter((c) => c.isEnabled),
      create: (data: Partial<DataClassificationEntity>) =>
        ({
          id: seq++,
          createdAt: new Date(),
          updatedAt: new Date(),
          lastEnforcedAt: null,
          ...data,
        }) as DataClassificationEntity,
      saveEntity: async (entity: DataClassificationEntity) => {
        const idx = storedClassifications.findIndex((c) => c.id === entity.id);
        if (idx >= 0) storedClassifications[idx] = entity;
        else storedClassifications.push(entity);
        return entity;
      },
    };

    const mockSensitiveFieldRepo = {
      findByResourceAndPath: async (res: string, path: string) =>
        storedFields.find((f) => f.resourceType === res && f.fieldPath === path) ?? null,
      findAll: async () => [...storedFields],
      findAllEnabled: async () => storedFields.filter((f) => f.isEnabled),
      create: (data: Partial<DataSensitiveFieldEntity>) =>
        ({
          id: seq++,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        }) as DataSensitiveFieldEntity,
      saveEntity: async (entity: DataSensitiveFieldEntity) => {
        const idx = storedFields.findIndex((f) => f.id === entity.id);
        if (idx >= 0) storedFields[idx] = entity;
        else storedFields.push(entity);
        return entity;
      },
    };

    classificationService = new DataClassificationService(
      mockClassificationRepo as never,
      mockSensitiveFieldRepo as never,
      undefined,
      hookRegistry,
      settingRegistry,
      featureFlagRegistry,
    );
    hookRegistry.registerSensitiveFieldEvaluator(classificationService);

    await classificationService.upsertSensitiveField(
      {
        resourceType: 'users',
        fieldPath: 'identityNumber',
        displayName: 'CCCD',
        classificationLevel: 'RESTRICTED',
        maskStrategy: 'PARTIAL',
        redactInLog: true,
        maskInExport: true,
        requiredPermission: 'data-governance.sensitive.read',
        isEnabled: true,
      },
      dpoAdmin,
    );

    await classificationService.upsertSensitiveField(
      {
        resourceType: 'users',
        fieldPath: 'email',
        displayName: 'Email',
        classificationLevel: 'CONFIDENTIAL',
        maskStrategy: 'EMAIL',
        redactInLog: false,
        maskInExport: true,
        requiredPermission: 'data-governance.sensitive.read',
        isEnabled: true,
      },
      dpoAdmin,
    );

    await classificationService.upsertSensitiveField(
      {
        resourceType: 'users',
        fieldPath: 'phone',
        displayName: 'Phone',
        classificationLevel: 'CONFIDENTIAL',
        maskStrategy: 'PHONE',
        redactInLog: true,
        maskInExport: true,
        requiredPermission: 'data-governance.sensitive.read',
        isEnabled: true,
      },
      dpoAdmin,
    );
  });

  afterEach(() => {
    configureDynamicSensitiveKeys([]);
    configureExtraSensitiveKeys([]);
  });

  it('syncs redactInLog fields into @packages/logging without clearing boot-time env keys', () => {
    configureExtraSensitiveKeys(['custom_boot_secret']);

    const redacted = redactSensitiveData({
      username: 'nguyenvana',
      identityNumber: '079204001234',
      phone: '0901234567',
      customBootSecret: 'top-secret-env',
      email: 'vana@company.vn',
    });

    expect(redacted.identityNumber).toBe('[REDACTED]');
    expect(redacted.phone).toBe('[REDACTED]');
    expect(redacted.customBootSecret).toBe('[REDACTED]');
    expect(redacted.email).toBe('vana@company.vn');
  });

  it('masks sensitive fields on read/export for regular staff and unmasks for authorized DPO', async () => {
    const rawUser = {
      id: 10,
      username: 'tranvanb',
      identityNumber: '001099012345',
      email: 'tranvanb@company.vn',
      phone: '0987654321',
    };

    const maskedForStaff = await classificationService.sanitizeRecordForActor(
      'users',
      rawUser,
      regularStaff,
      'read',
    );
    expect(maskedForStaff.identityNumber).not.toBe('001099012345');
    expect(maskedForStaff.identityNumber).toContain('00');
    expect(maskedForStaff.identityNumber).toContain('45');
    expect(maskedForStaff.email).not.toBe('tranvanb@company.vn');
    expect(maskedForStaff.phone).not.toBe('0987654321');

    const unmaskedForDpo = await classificationService.sanitizeRecordForActor(
      'users',
      rawUser,
      dpoAdmin,
      'read',
    );
    expect(unmaskedForDpo.identityNumber).toBe('001099012345');
    expect(unmaskedForDpo.email).toBe('tranvanb@company.vn');
    expect(unmaskedForDpo.phone).toBe('0987654321');
  });

  it('automatically masks sensitive CSV columns in ExportsService when actor lacks sensitive permission', async () => {
    const exportRegistry = new ExportRegistryService();
    exportRegistry.registerWorkerExecutor({
      profileCode: 'users',
      module: 'users',
      requiredPermission: 'users.export',
      executeExport: async () => ({
        fileName: 'users.csv',
        format: 'csv',
        totalExported: 1,
        csvContent:
          'username,email,identity_number,phone\ntranvanb,tranvanb@company.vn,001099012345,0987654321\n',
      }),
    });

    const exportsService = new ExportsService(undefined, exportRegistry, undefined, hookRegistry);

    const staffExport = await exportsService.executeExport(
      'users',
      { sortBy: 'id', sortOrder: 'ASC', format: 'csv', notifyOnComplete: false },
      regularStaff,
    );
    expect(staffExport.csvContent).toContain('tranvanb');
    expect(staffExport.csvContent).not.toContain('001099012345');
    expect(staffExport.csvContent).not.toContain('0987654321');
    expect(staffExport.csvContent).not.toContain('tranvanb@company.vn');

    const dpoExport = await exportsService.executeExport(
      'users',
      { sortBy: 'id', sortOrder: 'ASC', format: 'csv', notifyOnComplete: false },
      dpoAdmin,
    );
    expect(dpoExport.csvContent).toContain('001099012345');
    expect(dpoExport.csvContent).toContain('0987654321');
    expect(dpoExport.csvContent).toContain('tranvanb@company.vn');
  });

  it('disables mutations cleanly when optional feature flag data-governance.enabled is turned off', async () => {
    featureFlagRegistry.upsertDefinition({
      key: 'data-governance.enabled',
      module: 'data-governance',
      name: 'Enable Data Governance',
      description: 'Disabled for project',
      isEnabled: false,
      rolloutPercentage: 0,
      targetUserIds: [],
      targetRoles: [],
      targetOrganizationUnitIds: [],
      startsAt: null,
      endsAt: null,
      metadata: null,
      isSystem: true,
      status: 1,
    });

    await expect(
      classificationService.upsertClassification(
        {
          dataTypeCode: 'crm.leads',
          displayName: 'CRM Leads',
          moduleName: 'crm',
          classificationLevel: 'CONFIDENTIAL',
          containsPii: true,
          retentionDays: 180,
          retentionAction: 'PURGE',
          isEnabled: true,
        },
        dpoAdmin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenAppException);
  });
});

import { jest } from '@jest/globals';
import {
  CODE_ITEM_STATUS,
  CodeRegistryService,
  ConflictAppException,
  ForbiddenAppException,
  SettingRegistryService,
} from '@packages/kernel/index.js';
import {
  CODES_AUDIT_META,
  CODES_EXPORT_HEADERS,
  CodesService,
} from '../../../src/modules/codes/index.js';
import {
  applyCodeValueUpdatesToEntity,
  mapEntityToCodeTypeSummary,
  validateCodeValueCodeChange,
} from '../../../src/modules/codes/helpers/codes-value-mutation.helper.js';
import type { CodeTypeEntity } from '../../../src/modules/codes/entities/code-type.entity.js';
import type { CodeValueEntity } from '../../../src/modules/codes/entities/code-value.entity.js';
import type { CodeTypeRepository } from '../../../src/modules/codes/repositories/code-type.repository.js';
import type { CodeValueRepository } from '../../../src/modules/codes/repositories/code-value.repository.js';

type AsyncMockFn = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

describe('CodesModule — CodesService & Helpers Unit Tests', () => {
  let registry: CodeRegistryService;
  let settingRegistry: SettingRegistryService;
  let mockTypeRepo: {
    findByCode: AsyncMockFn;
    findFiltered: AsyncMockFn;
    saveEntity: AsyncMockFn;
  };
  let mockValueRepo: {
    findByTypeCode: AsyncMockFn;
    findByTypeAndNumericCode: AsyncMockFn;
    findAllOrdered: AsyncMockFn;
    saveEntity: AsyncMockFn;
    repository: { softDelete: AsyncMockFn };
  };
  let mockAuditLog: { record: AsyncMockFn };
  let service: CodesService;

  beforeEach(() => {
    registry = new CodeRegistryService();
    settingRegistry = new SettingRegistryService();
    mockTypeRepo = {
      findByCode: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(null),
      findFiltered: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue([]),
      saveEntity: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockImplementation(async (input) => ({
          id: 10,
          ...(input as Record<string, unknown>),
        })),
    };
    mockValueRepo = {
      findByTypeCode: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue([]),
      findByTypeAndNumericCode: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(null),
      findAllOrdered: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue([]),
      saveEntity: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockImplementation(async (input) => ({
          id: 100,
          ...(input as Record<string, unknown>),
        })),
      repository: {
        softDelete: jest
          .fn<(...args: unknown[]) => Promise<unknown>>()
          .mockResolvedValue({ affected: 1 }),
      },
    };
    mockAuditLog = {
      record: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
    };

    service = new CodesService(
      mockTypeRepo as unknown as CodeTypeRepository,
      mockValueRepo as unknown as CodeValueRepository,
      registry,
      null,
      mockAuditLog as never,
      settingRegistry,
    );
  });

  it('creates a new custom code type and records audit log with standardized metadata', async () => {
    const summary = await service.createCodeType({
      code: 'crm.customer_tier',
      module: 'crm',
      name: 'Phân hạng khách hàng',
      description: 'Hạng thành viên CRM',
      allowCustomValues: true,
      status: CODE_ITEM_STATUS.ACTIVE,
    });

    expect(summary.code).toBe('crm.customer_tier');
    expect(summary.module).toBe('crm');
    expect(summary.isSystem).toBe(false);
    expect(mockAuditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        module: CODES_AUDIT_META.MODULE,
        feature: CODES_AUDIT_META.FEATURES.TYPE_MANAGEMENT,
        action: CODES_AUDIT_META.ACTIONS.CREATE_TYPE,
        resourceId: 'crm.customer_tier',
      }),
    );
  });

  it('creates, updates and checks usage for dynamic code values via extracted helpers', async () => {
    const fakeTypeEntity = {
      id: 1,
      code: 'crm.lead_source',
      module: 'crm',
      name: 'Nguồn khách hàng',
      description: null,
      isSystem: false,
      allowCustomValues: true,
      status: CODE_ITEM_STATUS.ACTIVE,
    } as unknown as CodeTypeEntity;

    mockTypeRepo.findByCode.mockResolvedValue(fakeTypeEntity);

    const created = await service.createCodeValue('crm.lead_source', {
      code: 'WEBSITE',
      numericCode: 1,
      behaviorCode: 'INBOUND',
      name: 'Website chính thức',
      labels: { vi: 'Website chính thức', en: 'Official Website' },
      aliases: ['web', 'landing'],
      color: '#2563EB',
      status: CODE_ITEM_STATUS.ACTIVE,
    });

    expect(created.code).toBe('WEBSITE');
    expect(created.numericCode).toBe(1);
    expect(created.color).toBe('#2563EB');

    const fakeValueEntity = {
      id: 100,
      typeCode: 'crm.lead_source',
      numericCode: 1,
      code: 'WEBSITE',
      behaviorCode: 'INBOUND',
      name: 'Website chính thức',
      description: null,
      labelsJson: JSON.stringify({ vi: 'Website chính thức', en: 'Official Website' }),
      aliasesJson: JSON.stringify(['web']),
      color: '#2563EB',
      icon: null,
      sortOrder: 1,
      isDefault: false,
      isSystem: false,
      metadataJson: null,
      status: CODE_ITEM_STATUS.ACTIVE,
    } as unknown as CodeValueEntity;

    mockValueRepo.findByTypeAndNumericCode.mockResolvedValue(fakeValueEntity);

    const updated = await service.updateCodeValue('crm.lead_source', 1, {
      name: 'Cổng Website',
      color: '#14B8A6',
      sortOrder: 2,
    });

    expect(updated.name).toBe('Cổng Website');
    expect(updated.color).toBe('#14B8A6');
    expect(updated.sortOrder).toBe(2);
  });

  it('prevents changing code of a system anchor or an in-use value', async () => {
    const sysEntity = {
      id: 5,
      typeCode: 'users.status',
      numericCode: 1,
      code: 'ACTIVE',
      isSystem: true,
      labelsJson: null,
      aliasesJson: null,
      status: CODE_ITEM_STATUS.ACTIVE,
    } as unknown as CodeValueEntity;

    await expect(
      validateCodeValueCodeChange({
        normalizedType: 'users.status',
        numericCode: 1,
        entity: sysEntity,
        rawNextCode: 'ENABLED',
        registry,
        codeValueRepository: mockValueRepo as unknown as CodeValueRepository,
      }),
    ).rejects.toBeInstanceOf(ForbiddenAppException);

    const customEntity = {
      ...sysEntity,
      typeCode: 'crm.tier',
      code: 'GOLD',
      isSystem: false,
    } as unknown as CodeValueEntity;

    jest.spyOn(registry, 'checkValueUsage').mockResolvedValueOnce({
      typeCode: 'crm.tier',
      numericCode: 1,
      code: 'GOLD',
      inUse: true,
      totalUsageCount: 5,
      details: [{ source: 'crm.customers', count: 5 }],
    });

    await expect(
      validateCodeValueCodeChange({
        normalizedType: 'crm.tier',
        numericCode: 1,
        entity: customEntity,
        rawNextCode: 'PLATINUM',
        registry,
        codeValueRepository: mockValueRepo as unknown as CodeValueRepository,
      }),
    ).rejects.toBeInstanceOf(ConflictAppException);
  });

  it('exports import template and maps entity to summary accurately', () => {
    const tpl = service.exportImportTemplate('csv');
    expect(tpl.format).toBe('csv');
    expect(tpl.fileName).toContain('.csv');
    expect(CODES_EXPORT_HEADERS.length).toBe(12);

    const entity = {
      id: 99,
      code: 'common.gender',
      module: 'common',
      name: 'Giới tính',
      description: 'Danh mục giới tính',
      isSystem: true,
      allowCustomValues: false,
      status: CODE_ITEM_STATUS.ACTIVE,
    } as unknown as CodeTypeEntity;

    applyCodeValueUpdatesToEntity(
      {
        name: 'Nam',
        labelsJson: null,
        aliasesJson: null,
        metadataJson: null,
        isSystem: false,
      } as unknown as CodeValueEntity,
      { name: 'Nam giới', aliases: ['male'] },
    );

    const summary = mapEntityToCodeTypeSummary(entity, registry, 'vi', { includeValues: true });
    expect(summary.id).toBe(99);
    expect(summary.code).toBe('common.gender');
  });
});

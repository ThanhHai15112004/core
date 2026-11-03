import {
  BadRequestAppException,
  ConflictAppException,
  CustomFieldRegistryService,
  ForbiddenAppException,
  defaultSettingRegistry,
  discoverManifestCustomFields,
  discoverManifestExtensibleEntities,
  parseCustomFieldFiltersParam,
} from '@packages/kernel/index.js';
import { FieldEncryptionService } from '@packages/security/index.js';
import { CustomFieldsService } from '../../../src/modules/custom-fields/index.js';
import type { CustomFieldDefinitionEntity } from '../../../src/modules/custom-fields/entities/custom-field-definition.entity.js';
import type { CustomFieldOptionEntity } from '../../../src/modules/custom-fields/entities/custom-field-option.entity.js';
import type { CustomFieldValueEntity } from '../../../src/modules/custom-fields/entities/custom-field-value.entity.js';
import type { CustomFieldHistoryEntity } from '../../../src/modules/custom-fields/entities/custom-field-history.entity.js';
import type { CustomFieldDefinitionRepository } from '../../../src/modules/custom-fields/repositories/custom-field-definition.repository.js';
import type { CustomFieldOptionRepository } from '../../../src/modules/custom-fields/repositories/custom-field-option.repository.js';
import type { CustomFieldValueRepository } from '../../../src/modules/custom-fields/repositories/custom-field-value.repository.js';
import type { CustomFieldHistoryRepository } from '../../../src/modules/custom-fields/repositories/custom-field-history.repository.js';

function createInMemoryCustomFieldsHarness() {
  defaultSettingRegistry.bootstrapFromManifests();
  const registry = new CustomFieldRegistryService();
  const fieldEncryptionService = new FieldEncryptionService();

  let defSeq = 1;
  let optSeq = 1;
  let valSeq = 1;
  let histSeq = 1;

  const definitions = new Map<number, CustomFieldDefinitionEntity>();
  const options = new Map<number, CustomFieldOptionEntity>();
  const values = new Map<number, CustomFieldValueEntity>();
  const histories = new Map<number, CustomFieldHistoryEntity>();

  const definitionRepository = {
    findAllOrdered: async () =>
      [...definitions.values()].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.fieldKey.localeCompare(b.fieldKey),
      ),
    findByEntityAndKey: async (entityCode: string, fieldKey: string) =>
      [...definitions.values()].find(
        (d) =>
          d.entityCode === entityCode.trim().toLowerCase() &&
          d.fieldKey === fieldKey.trim().toLowerCase(),
      ) ?? null,
    upsertDefinition: async (
      payload: Partial<CustomFieldDefinitionEntity> & {
        readonly entityCode: string;
        readonly fieldKey: string;
      },
    ) => {
      const existing = [...definitions.values()].find(
        (d) =>
          d.entityCode === payload.entityCode.trim().toLowerCase() &&
          d.fieldKey === payload.fieldKey.trim().toLowerCase(),
      );
      const id = existing ? Number(existing.id) : defSeq++;
      const saved = {
        ...existing,
        ...payload,
        id,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      } as CustomFieldDefinitionEntity;
      definitions.set(id, saved);
      return saved;
    },
  } as unknown as CustomFieldDefinitionRepository;

  const optionRepository = {
    findAllOrdered: async () =>
      [...options.values()].sort((a, b) => a.sortOrder - b.sortOrder || Number(a.id) - Number(b.id)),
    replaceOptionsForField: async (
      fieldId: string,
      items: Array<Partial<CustomFieldOptionEntity>>,
    ) => {
      for (const [k, v] of options.entries()) {
        if (String(v.fieldId) === String(fieldId)) {
          options.delete(k);
        }
      }
      const created: CustomFieldOptionEntity[] = [];
      for (const item of items) {
        const id = optSeq++;
        const row = {
          ...item,
          id,
          fieldId: String(fieldId),
          createdAt: new Date(),
          updatedAt: new Date(),
        } as CustomFieldOptionEntity;
        options.set(id, row);
        created.push(row);
      }
      return created;
    },
  } as unknown as CustomFieldOptionRepository;

  const valueRepository = {
    findAllValues: async () => [...values.values()],
    upsertValue: async (
      payload: Partial<CustomFieldValueEntity> & {
        readonly entityCode: string;
        readonly recordId: string;
        readonly fieldKey: string;
      },
    ) => {
      const existing = [...values.values()].find(
        (v) =>
          v.entityCode === payload.entityCode &&
          v.recordId === payload.recordId &&
          v.fieldKey === payload.fieldKey,
      );
      const id = existing ? Number(existing.id) : valSeq++;
      const saved = {
        ...existing,
        ...payload,
        id,
        createdAt: existing?.createdAt ?? new Date(),
        updatedAt: new Date(),
      } as CustomFieldValueEntity;
      values.set(id, saved);
      return saved;
    },
  } as unknown as CustomFieldValueRepository;

  const historyRepository = {
    findAllOrdered: async (limit = 200) =>
      [...histories.values()].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, limit),
    recordHistory: async (payload: Partial<CustomFieldHistoryEntity>) => {
      const id = histSeq++;
      const row = {
        ...payload,
        id,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as CustomFieldHistoryEntity;
      histories.set(id, row);
      return row;
    },
  } as unknown as CustomFieldHistoryRepository;

  const service = new CustomFieldsService(
    registry,
    defaultSettingRegistry,
    fieldEncryptionService,
    definitionRepository,
    optionRepository,
    valueRepository,
    historyRepository,
  );

  return {
    registry,
    service,
    fieldEncryptionService,
    definitions,
    options,
    values,
    histories,
  };
}

describe('Phase 9.8 — Trường tùy chỉnh và Metadata (Custom Fields & Metadata)', () => {
  describe('9.8.1 Đăng ký loại đối tượng được mở rộng (Chỉ module cho phép mới dùng custom field)', () => {
    it('discovers extensible entities from module manifests and blocks unregistered entities', async () => {
      const { service, registry } = createInMemoryCustomFieldsHarness();
      await service.onModuleInit();

      const discoveredEntities = discoverManifestExtensibleEntities();
      expect(discoveredEntities.some((e) => e.code === 'users.user')).toBe(true);
      expect(
        discoveredEntities.some((e) => e.code === 'organizations.organization_unit'),
      ).toBe(true);

      const discoveredFields = discoverManifestCustomFields();
      expect(discoveredFields.some((f) => f.fieldKey === 'employee_level')).toBe(true);
      expect(discoveredFields.some((f) => f.fieldKey === 'cost_center_code')).toBe(true);

      const entities = service.listRegisteredEntitiesWithSummary();
      expect(entities.map((e) => e.code)).toEqual(
        expect.arrayContaining(['users.user', 'organizations.organization_unit']),
      );

      // Chặn tạo trường tùy chỉnh cho loại đối tượng không đăng ký mở rộng
      await expect(
        service.createDefinition({
          entityCode: 'audit_logs.immutable_record',
          fieldKey: 'extra_note',
          name: 'Ghi chú thêm',
          dataType: 'TEXT',
        }),
      ).rejects.toThrow(ForbiddenAppException);

      // Chặn lưu giá trị trường tùy chỉnh cho đối tượng không đăng ký
      expect(() =>
        registry.setRecordCustomFields({
          entityCode: 'unregistered.module_entity',
          recordId: 100,
          values: { extra_note: 'test' },
        }),
      ).toThrow(ForbiddenAppException);
    });
  });

  describe('9.8.2 Tạo trường tùy chỉnh (Text, Number, Date, Boolean hoặc Select)', () => {
    it('creates custom fields of all 5 data types (TEXT, NUMBER, DATE, BOOLEAN, SELECT) and rejects duplicate keys', async () => {
      const { service } = createInMemoryCustomFieldsHarness();
      await service.onModuleInit();

      const textField = await service.createDefinition({
        entityCode: 'users.user',
        fieldKey: 'badge_serial',
        name: 'Mã thẻ từ',
        dataType: 'TEXT',
        validationRules: { minLength: 4, maxLength: 12, pattern: '^[A-Z0-9-]+$' },
        isIndexed: true,
      });
      expect(textField.dataType).toBe('TEXT');

      const numField = await service.createDefinition({
        entityCode: 'users.user',
        fieldKey: 'years_of_experience',
        name: 'Số năm kinh nghiệm',
        dataType: 'NUMBER',
        validationRules: { min: 0, max: 50, integerOnly: true },
        isIndexed: true,
      });
      expect(numField.dataType).toBe('NUMBER');

      const dateField = await service.createDefinition({
        entityCode: 'users.user',
        fieldKey: 'probation_end_date',
        name: 'Ngày kết thúc thử việc',
        dataType: 'DATE',
        validationRules: { minDate: '2020-01-01', maxDate: '2035-12-31' },
        isIndexed: true,
      });
      expect(dateField.dataType).toBe('DATE');

      const boolField = await service.createDefinition({
        entityCode: 'users.user',
        fieldKey: 'parking_registered',
        name: 'Đăng ký gửi xe',
        dataType: 'BOOLEAN',
        defaultValue: false,
        isIndexed: true,
      });
      expect(boolField.dataType).toBe('BOOLEAN');

      const selectField = await service.createDefinition({
        entityCode: 'users.user',
        fieldKey: 'shirt_size',
        name: 'Cỡ áo đồng phục',
        dataType: 'SELECT',
        options: [
          { optionCode: 'S', label: 'Size S', color: null, sortOrder: 1, isDefault: false, status: 1 },
          { optionCode: 'M', label: 'Size M', color: null, sortOrder: 2, isDefault: true, status: 1 },
          { optionCode: 'L', label: 'Size L', color: null, sortOrder: 3, isDefault: false, status: 1 },
        ],
        isIndexed: true,
      });
      expect(selectField.dataType).toBe('SELECT');
      expect(selectField.options).toHaveLength(3);

      // Chặn tạo trường trùng fieldKey trên cùng đối tượng
      await expect(
        service.createDefinition({
          entityCode: 'users.user',
          fieldKey: 'badge_serial',
          name: 'Trùng mã',
          dataType: 'TEXT',
        }),
      ).rejects.toThrow(ConflictAppException);

      // Chặn tạo trường SELECT không có lựa chọn ACTIVE
      await expect(
        service.createDefinition({
          entityCode: 'users.user',
          fieldKey: 'empty_select',
          name: 'Select rỗng',
          dataType: 'SELECT',
          options: [],
        }),
      ).rejects.toThrow(BadRequestAppException);
    });
  });

  describe('9.8.3 Thiết lập bắt buộc và validation (Kiểm tra khi lưu)', () => {
    it('enforces isRequired and validationRules for TEXT, NUMBER, DATE, BOOLEAN, and SELECT when saving', async () => {
      const { service } = createInMemoryCustomFieldsHarness();
      await service.onModuleInit();

      await service.createDefinition({
        entityCode: 'users.user',
        fieldKey: 'contract_code',
        name: 'Mã hợp đồng lao động',
        dataType: 'TEXT',
        isRequired: true,
        validationRules: {
          minLength: 5,
          maxLength: 15,
          pattern: '^HD-[0-9]+$',
        },
      });

      const superAdminCtx = {
        id: 1,
        permissions: [
          'users.read',
          'users.update',
          'custom-fields.sensitive.read',
          'custom-fields.sensitive.write',
        ],
        roles: ['super_admin'],
      };

      // 1. Kiểm tra bắt buộc (isRequired = true) khi tạo mới (mode = 'create')
      await expect(
        service.validateAndSaveRecordValues({
          entityCode: 'users.user',
          recordId: 10,
          values: { employee_level: 'L3' },
          mode: 'create',
          actor: superAdminCtx,
        }),
      ).rejects.toThrow(BadRequestAppException);

      // 2. Kiểm tra độ dài tối thiểu & pattern của TEXT
      await expect(
        service.validateAndSaveRecordValues({
          entityCode: 'users.user',
          recordId: 10,
          values: { contract_code: 'HD1' },
          actor: superAdminCtx,
        }),
      ).rejects.toThrow(BadRequestAppException);

      await expect(
        service.validateAndSaveRecordValues({
          entityCode: 'users.user',
          recordId: 10,
          values: { contract_code: 'INVALID-FORMAT' },
          actor: superAdminCtx,
        }),
      ).rejects.toThrow(BadRequestAppException);

      // 3. Kiểm tra min/max của NUMBER (annual_bonus_target: 0..200)
      await expect(
        service.validateAndSaveRecordValues({
          entityCode: 'users.user',
          recordId: 10,
          values: { contract_code: 'HD-202601', annual_bonus_target: 350 },
          actor: superAdminCtx,
        }),
      ).rejects.toThrow(BadRequestAppException);

      // 4. Kiểm tra khoảng ngày của DATE (onboarding_date: 2010-01-01..2035-12-31)
      await expect(
        service.validateAndSaveRecordValues({
          entityCode: 'users.user',
          recordId: 10,
          values: { contract_code: 'HD-202601', onboarding_date: '1999-05-01' },
          actor: superAdminCtx,
        }),
      ).rejects.toThrow(BadRequestAppException);

      // 5. Lưu hợp lệ tất cả các kiểu dữ liệu
      await service.validateAndSaveRecordValues({
        entityCode: 'users.user',
        recordId: 10,
        values: {
          contract_code: 'HD-202601',
          employee_level: 'L4',
          onboarding_date: '2024-03-15',
          remote_eligible: true,
          annual_bonus_target: 25,
        },
        mode: 'create',
        actor: superAdminCtx,
      });

      const resolved = await service.getRecordValuesForApi('users.user', 10, {
        viewMode: 'detail',
        actor: superAdminCtx,
      });

      expect(resolved).toMatchObject({
        contract_code: 'HD-202601',
        employee_level: 'L4',
        onboarding_date: '2024-03-15',
        remote_eligible: true,
        annual_bonus_target: 25,
      });
    });
  });

  describe('9.8.4 Thiết lập quyền xem và sửa từng trường (Bảo vệ dữ liệu nhạy cảm & Mã hóa)', () => {
    it('protects sensitive fields via field-level view/edit permissions and encrypts sensitive values at rest', async () => {
      const { service, values } = createInMemoryCustomFieldsHarness();
      await service.onModuleInit();

      const hrAdminCtx = {
        id: 4,
        permissions: [
          'users.read',
          'users.update',
          'custom-fields.sensitive.read',
          'custom-fields.sensitive.write',
        ],
        roles: ['admin_hr'],
      };

      const regularStaffCtx = {
        id: 11,
        permissions: ['users.read', 'users.update'],
        roles: ['staff'],
      };

      // Nhân viên thường cố tình sửa trường nhạy cảm `tax_id_number` -> bị chặn 403 Forbidden
      await expect(
        service.validateAndSaveRecordValues({
          entityCode: 'users.user',
          recordId: 1,
          values: { tax_id_number: '8012345678' },
          actor: regularStaffCtx,
        }),
      ).rejects.toThrow(ForbiddenAppException);

      // HR Admin có quyền `custom-fields.sensitive.write` lưu thành công
      await service.validateAndSaveRecordValues({
        entityCode: 'users.user',
        recordId: 1,
        values: {
          employee_level: 'L5',
          tax_id_number: '8012345678',
          annual_bonus_target: 30,
        },
        actor: hrAdminCtx,
      });

      // Kiểm tra trong DB: trường nhạy cảm `tax_id_number` được mã hóa AES-256-GCM (encryptedValue có giá trị, valueText = null)
      const storedTaxRow = [...values.values()].find(
        (v) => v.entityCode === 'users.user' && v.recordId === '1' && v.fieldKey === 'tax_id_number',
      );
      expect(storedTaxRow).toBeDefined();
      expect(storedTaxRow?.encryptedValue).toBeTruthy();
      expect(storedTaxRow?.valueText).toBeNull();
      expect(storedTaxRow?.valueJson).toBeNull();

      // Nhân viên thường xem bản ghi: chỉ thấy `employee_level`, KHÔNG thấy `tax_id_number` và `annual_bonus_target`
      const staffView = await service.getRecordValuesForApi('users.user', 1, {
        viewMode: 'detail',
        actor: regularStaffCtx,
      });
      expect(staffView.employee_level).toBe('L5');
      expect(staffView.tax_id_number).toBeUndefined();
      expect(staffView.annual_bonus_target).toBeUndefined();

      // HR Admin xem bản ghi: thấy đầy đủ cả trường nhạy cảm
      const hrView = await service.getRecordValuesForApi('users.user', 1, {
        viewMode: 'detail',
        actor: hrAdminCtx,
      });
      expect(hrView.employee_level).toBe('L5');
      expect(hrView.tax_id_number).toBe('8012345678');
      expect(hrView.annual_bonus_target).toBe(30);
    });
  });

  describe('9.8.5 Tạo danh sách lựa chọn (Có thứ tự và trạng thái)', () => {
    it('maintains option sortOrder and status, and rejects selecting INACTIVE options when saving', async () => {
      const { service, registry } = createInMemoryCustomFieldsHarness();
      await service.onModuleInit();

      const empLevelDef = registry.getFieldDefinition('users.user', 'employee_level')!;
      const updatedDef = await service.updateFieldOptions(
        empLevelDef.id,
        [
          { optionCode: 'L3', label: 'Senior', color: null, sortOrder: 30, isDefault: false, status: 1 },
          { optionCode: 'L1', label: 'Junior', color: null, sortOrder: 10, isDefault: false, status: 1 },
          { optionCode: 'L2', label: 'Mid', color: null, sortOrder: 20, isDefault: true, status: 1 },
          { optionCode: 'L0_RETIRED', label: 'Retired Level', color: null, sortOrder: 40, isDefault: false, status: 2 },
        ],
        1,
        'Sắp xếp lại thứ tự và khóa lựa chọn L0_RETIRED',
      );

      // Các lựa chọn phải được sắp xếp đúng theo sortOrder (10 -> 20 -> 30 -> 40)
      expect(updatedDef.options.map((o) => o.optionCode)).toEqual([
        'L1',
        'L2',
        'L3',
        'L0_RETIRED',
      ]);

      // Chọn giá trị đang INACTIVE (status = 2) phải bị từ chối khi lưu
      await expect(
        service.validateAndSaveRecordValues({
          entityCode: 'users.user',
          recordId: 2,
          values: { employee_level: 'L0_RETIRED' },
          actor: { id: 1, permissions: ['users.update'], roles: ['super_admin'] },
        }),
      ).rejects.toThrow(BadRequestAppException);
    });
  });

  describe('9.8.6 Hiển thị trường tùy chỉnh trong API (Theo cấu hình showInApi / showInList / showInDetail)', () => {
    it('filters returned customFields by showInApi, showInList, and showInDetail configuration', async () => {
      const { service, registry } = createInMemoryCustomFieldsHarness();
      await service.onModuleInit();

      const adminCtx = {
        id: 1,
        permissions: [
          'users.read',
          'users.update',
          'custom-fields.sensitive.read',
          'custom-fields.sensitive.write',
        ],
        roles: ['super_admin'],
      };

      await service.validateAndSaveRecordValues({
        entityCode: 'users.user',
        recordId: 5,
        values: {
          employee_level: 'L3',
          tax_id_number: '8099887766',
        },
        actor: adminCtx,
      });

      // `tax_id_number` có cấu hình showInList = false, showInDetail = true
      const listResponse = await service.getRecordValuesForApi('users.user', 5, {
        viewMode: 'list',
        actor: adminCtx,
      });
      expect(listResponse.employee_level).toBe('L3');
      expect(listResponse.tax_id_number).toBeUndefined();

      const detailResponse = await service.getRecordValuesForApi('users.user', 5, {
        viewMode: 'detail',
        actor: adminCtx,
      });
      expect(detailResponse.employee_level).toBe('L3');
      expect(detailResponse.tax_id_number).toBe('8099887766');

      // Tắt showInApi trên employee_level -> biến mất khỏi cả list và detail API
      const empLevelDef = registry.getFieldDefinition('users.user', 'employee_level')!;
      await service.updateDefinition(
        empLevelDef.id,
        { showInApi: false },
        1,
      );

      const afterHideApi = await service.getRecordValuesForApi('users.user', 5, {
        viewMode: 'detail',
        actor: adminCtx,
      });
      expect(afterHideApi.employee_level).toBeUndefined();
    });
  });

  describe('9.8.7 Cho phép lọc một số trường tùy chỉnh (Chỉ field được đánh index)', () => {
    it('allows filtering on indexed fields and blocks filtering on non-indexed fields', async () => {
      const { service } = createInMemoryCustomFieldsHarness();
      await service.onModuleInit();

      const adminCtx = {
        id: 1,
        permissions: [
          'users.read',
          'users.update',
          'organizations.read',
          'organizations.manage',
          'custom-fields.sensitive.read',
          'custom-fields.sensitive.write',
        ],
        roles: ['super_admin'],
      };

      await service.validateAndSaveRecordValues({
        entityCode: 'organizations.organization_unit',
        recordId: 1,
        values: { cost_center_code: 'CC-HQ-001', headcount_quota: 200, region_tier: 'TIER_1' },
        actor: adminCtx,
      });
      await service.validateAndSaveRecordValues({
        entityCode: 'organizations.organization_unit',
        recordId: 2,
        values: { cost_center_code: 'CC-ENG-002', headcount_quota: 80, region_tier: 'TIER_1' },
        actor: adminCtx,
      });
      await service.validateAndSaveRecordValues({
        entityCode: 'organizations.organization_unit',
        recordId: 3,
        values: { cost_center_code: 'CC-SALES-003', headcount_quota: 30, region_tier: 'TIER_2' },
        actor: adminCtx,
      });

      // Lọc theo trường đã đánh index (`region_tier = TIER_1` VÀ `headcount_quota >= 100`)
      const filterRes = await service.filterRecordsEndpoint(
        {
          entityCode: 'organizations.organization_unit',
          filters: [
            { fieldKey: 'region_tier', operator: 'eq', value: 'TIER_1' },
            { fieldKey: 'headcount_quota', operator: 'gte', value: 100 },
          ],
        },
        adminCtx,
      );
      expect(filterRes.matchedRecordIds).toEqual(['1']);
      expect(filterRes.totalMatched).toBe(1);

      // Thử lọc theo trường KHÔNG đánh index (`tax_id_number` có `isIndexed = false`) -> Bị chặn ngay
      await expect(
        service.filterRecordsEndpoint(
          {
            entityCode: 'users.user',
            filters: [{ fieldKey: 'tax_id_number', operator: 'eq', value: '8012345678' }],
          },
          adminCtx,
        ),
      ).rejects.toThrow(BadRequestAppException);

      // Kiểm tra helper parseCustomFieldFiltersParam cho query string API
      const parsedFromObject = parseCustomFieldFiltersParam(
        '{"region_tier":"TIER_1","headcount_quota":200}',
      );
      expect(parsedFromObject).toEqual([
        { fieldKey: 'region_tier', operator: 'eq', value: 'TIER_1' },
        { fieldKey: 'headcount_quota', operator: 'eq', value: 200 },
      ]);
    });
  });

  describe('9.8.8 Ghi lịch sử thay đổi cấu hình trường (Không đổi kiểu dữ liệu tùy tiện)', () => {
    it('blocks arbitrary dataType changes and records full configuration change history', async () => {
      const { service, registry } = createInMemoryCustomFieldsHarness();
      await service.onModuleInit();

      const costCenterDef = registry.getFieldDefinition(
        'organizations.organization_unit',
        'cost_center_code',
      )!;

      // Thử đổi kiểu dữ liệu của `cost_center_code` từ TEXT sang NUMBER -> Phải bị chặn bằng ConflictAppException
      await expect(
        service.updateDefinition(
          costCenterDef.id,
          {
            dataType: 'NUMBER',
            reason: 'Cố tình đổi kiểu dữ liệu từ TEXT sang NUMBER',
          },
          2,
        ),
      ).rejects.toThrow(ConflictAppException);

      // Kiểm tra lịch sử đã ghi nhận bản ghi DATA_TYPE_CHANGE_BLOCKED
      const histories = await service.listHistories({
        fieldId: costCenterDef.id,
      });
      const blockedHistory = histories.find((h) => h.actionType === 'DATA_TYPE_CHANGE_BLOCKED');
      expect(blockedHistory).toBeDefined();
      expect(blockedHistory?.afterSnapshot).toMatchObject({
        attemptedDataType: 'NUMBER',
      });

      // Cập nhật cấu hình hợp lệ (giữ nguyên dataType = TEXT) -> Tăng version và ghi lịch sử UPDATED
      const updated = await service.updateDefinition(
        costCenterDef.id,
        {
          isRequired: true,
          validationRules: { minLength: 4, maxLength: 24, pattern: '^CC-[A-Z0-9-]+$' },
          reason: 'Bắt buộc nhập mã Cost Center theo chuẩn ERP mới',
        },
        1,
      );
      expect(updated.isRequired).toBe(true);
      expect(updated.version).toBeGreaterThan(1);

      const updatedHistories = await service.listHistories({
        fieldId: costCenterDef.id,
      });
      const updateEntry = updatedHistories.find((h) => h.actionType === 'UPDATED');
      expect(updateEntry).toBeDefined();
      expect(updateEntry?.changedFields).toEqual(
        expect.arrayContaining(['isRequired', 'validationRules']),
      );
    });
  });
});

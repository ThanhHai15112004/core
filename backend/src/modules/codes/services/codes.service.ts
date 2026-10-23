import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';
import {
  CODE_ITEM_STATUS,
  type CodeItemStatusCode,
  CodeRegistryService,
  type CodeTypeManifestItem,
  type CodeValueUsageCheckResult,
  ConflictAppException,
  ForbiddenAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
  type ResolvedCodeValueView,
  SettingRegistryService,
  defaultCodeRegistry,
  defaultSettingRegistry,
  discoverManifestCodeTypes,
} from '@packages/kernel/index.js';
import {
  CoreI18nService,
  type SupportedLocale,
  isSupportedLocale,
  resolveSystemDefaultLocale,
} from '@packages/i18n/index.js';
import { AuditLogService } from '@packages/security/index.js';
import type { CodeTypeSummary, ICodesPublicService, SyncCodesResult } from '../contracts/index.js';
import type { CodeTypeEntity } from '../entities/code-type.entity.js';
import type { CodeValueEntity } from '../entities/code-value.entity.js';
import { CODES_AUDIT_META } from '../enum/codes.enum.js';
import {
  buildCodesExportPayload,
  buildCodesImportTemplatePayload,
  executeBulkImportCodeValues,
} from '../helpers/codes-import-export.helper.js';
import {
  mapCodeValueEntityToManifestItem,
  refreshCodeRegistryFromDatabase,
  refreshSingleCodeTypeFromDatabase,
  syncDeclaredCodeTypesAndValuesToDatabase,
} from '../helpers/codes-manifest-sync.helper.js';
import {
  applyCodeValueUpdatesToEntity,
  mapEntityToCodeTypeSummary,
  validateCodeValueCodeChange,
} from '../helpers/codes-value-mutation.helper.js';
import { CodeTypeRepository } from '../repositories/code-type.repository.js';
import { CodeValueRepository } from '../repositories/code-value.repository.js';
import type {
  BootstrapCodesQuery,
  BulkImportCodesRequest,
  CreateCodeTypeRequest,
  CreateCodeValueRequest,
  ExportCodesQuery,
  ListCodeTypesQuery,
  ListCodeValuesQuery,
  ReorderCodeValuesRequest,
  UpdateCodeTypeRequest,
  UpdateCodeValueRequest,
} from '../requests/codes.requests.js';
import type {
  BulkImportCodesResultResponse,
  ExportCodesResponse,
} from '../responses/codes.response.js';
import type { CodeTypeSummaryBuildOptions } from '../types/codes.types.js';

@Injectable()
export class CodesService implements ICodesPublicService, OnModuleInit {
  private readonly manifestCodeTypes = new Map<string, CodeTypeManifestItem>();
  private readonly registry: CodeRegistryService;
  private readonly settingRegistry: SettingRegistryService;

  constructor(
    private readonly codeTypeRepository: CodeTypeRepository,
    private readonly codeValueRepository: CodeValueRepository,
    @Optional()
    @Inject(CodeRegistryService)
    codeRegistryService: CodeRegistryService | null = null,
    @Optional()
    @Inject(CoreI18nService)
    private readonly i18nService: CoreI18nService | null = null,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService: AuditLogService | null = null,
    @Optional()
    @Inject(SettingRegistryService)
    settingRegistryService: SettingRegistryService | null = null,
  ) {
    this.registry = codeRegistryService ?? defaultCodeRegistry;
    this.settingRegistry = settingRegistryService ?? defaultSettingRegistry;
    this.configureI18nBridge();
    this.discoverManifestCodeTypes();
  }

  public async onModuleInit(): Promise<void> {
    try {
      await this.syncManifests();
    } catch {
      // Safe fallback to L1 memory when DB tables are not yet initialized in isolated unit tests
    }
  }

  /** Lấy toàn bộ từ điển danh mục động (Bootstrap Dictionary) cho Frontend/Mobile trong 1 request */
  public async getBootstrapDictionary(query: BootstrapCodesQuery = {}): Promise<{
    locale: string;
    totalTypes: number;
    dictionary: Record<string, ResolvedCodeValueView[]>;
  }> {
    await this.refreshRegistryFromDatabaseSafe();
    const locale = this.resolveEffectiveLocale(query.locale);
    const dictionary = this.registry.getBootstrapDictionary({
      locale,
      module: query.module,
      includeInactive: query.includeInactive ?? false,
    });
    return {
      locale,
      totalTypes: Object.keys(dictionary).length,
      dictionary,
    };
  }

  /** Liệt kê danh sách nhóm danh mục (`code_types`) có lọc theo module hoặc từ khóa */
  public async listCodeTypes(query: ListCodeTypesQuery = {}): Promise<CodeTypeSummary[]> {
    await this.refreshRegistryFromDatabaseSafe();
    const locale = this.resolveEffectiveLocale(query.locale);
    const dbTypes = await this.findDbCodeTypesSafe(query);

    if (dbTypes.length > 0) {
      return dbTypes.map((ct) =>
        this.toCodeTypeSummary(ct, {
          locale,
          includeValues: query.includeValues,
        }),
      );
    }

    const memTypes = this.registry.listTypes({
      module: query.module,
      search: query.search,
    });

    return memTypes.map((ct, idx) => {
      const values = this.registry.listValues(ct.code, {
        includeInactive: true,
        locale,
      });
      return {
        id: idx + 1,
        code: ct.code,
        module: ct.module,
        name: ct.name,
        description: ct.description,
        isSystem: ct.isSystem,
        allowCustomValues: ct.allowCustomValues,
        status: ct.status,
        totalValues: values.length,
        ...(query.includeValues ? { values } : {}),
      };
    });
  }

  /** Lấy danh sách giá trị (`code_values`) của một nhóm danh mục `typeCode` */
  public async listCodeValues(
    typeCode: string,
    query: ListCodeValuesQuery = {},
  ): Promise<ResolvedCodeValueView[]> {
    const normalizedType = typeCode.trim().toLowerCase();
    await this.refreshTypeFromDatabaseSafe(normalizedType);

    const typeMeta = this.registry.getType(normalizedType);
    if (!typeMeta) {
      throw new NotFoundAppException('codes.typeNotFound', { typeCode: normalizedType });
    }

    const locale = this.resolveEffectiveLocale(query.locale);
    return this.registry.listValues(normalizedType, {
      includeInactive: query.includeInactive ?? false,
      locale,
    });
  }

  /** Tạo mới một nhóm danh mục dùng chung (`code_types` — Mục 5.4.1) */
  public async createCodeType(dto: CreateCodeTypeRequest): Promise<CodeTypeSummary> {
    const rawCode = dto.code.trim().toLowerCase();
    const inferredModule = (
      dto.module?.trim() || (rawCode.includes('.') ? rawCode.split('.')[0]! : 'common')
    ).toLowerCase();
    const normalizedCode = rawCode.includes('.') ? rawCode : `${inferredModule}.${rawCode}`;

    const existing = await this.codeTypeRepository.findByCode(normalizedCode);
    if (existing || this.manifestCodeTypes.has(normalizedCode)) {
      throw new ConflictAppException(
        'codes.duplicateTypeCode',
        [{ code: normalizedCode }],
        { code: normalizedCode },
        HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
      );
    }

    const status =
      dto.status === CODE_ITEM_STATUS.INACTIVE
        ? CODE_ITEM_STATUS.INACTIVE
        : CODE_ITEM_STATUS.ACTIVE;

    const saved = await this.codeTypeRepository.saveEntity({
      code: normalizedCode,
      module: inferredModule,
      name: dto.name.trim(),
      description: dto.description ?? null,
      isSystem: false,
      allowCustomValues: dto.allowCustomValues ?? true,
      status,
    });

    this.registry.registerCodeType({
      id: Number(saved.id),
      code: saved.code,
      module: saved.module,
      name: saved.name,
      description: saved.description ?? null,
      isSystem: false,
      allowCustomValues: Boolean(saved.allowCustomValues),
      status: saved.status,
      values: [],
    });

    await this.auditLogService?.record({
      module: CODES_AUDIT_META.MODULE,
      feature: CODES_AUDIT_META.FEATURES.TYPE_MANAGEMENT,
      action: CODES_AUDIT_META.ACTIONS.CREATE_TYPE,
      resourceType: 'code_type',
      resourceId: saved.code,
      beforeData: null,
      afterData: {
        id: saved.id,
        code: saved.code,
        module: saved.module,
        name: saved.name,
        allowCustomValues: saved.allowCustomValues,
        status: saved.status,
      },
      reason: `Created master data code type ${saved.code}`,
    });

    return this.toCodeTypeSummary(saved, { includeValues: true });
  }

  /** Cập nhật thông tin nhóm danh mục (`code_types` — Mục 5.4.1) */
  public async updateCodeType(
    typeCode: string,
    dto: UpdateCodeTypeRequest,
  ): Promise<CodeTypeSummary> {
    const normalizedType = typeCode.trim().toLowerCase();
    const entity = await this.ensureCodeTypeExists(normalizedType);

    if (entity.isSystem && dto.status === CODE_ITEM_STATUS.INACTIVE) {
      throw new ForbiddenAppException('codes.cannotDeactivateSystemType', [
        { code: normalizedType },
      ]);
    }

    const beforeSnapshot = {
      name: entity.name,
      description: entity.description,
      allowCustomValues: entity.allowCustomValues,
      status: entity.status,
    };

    if (dto.name !== undefined) entity.name = dto.name.trim();
    if (dto.description !== undefined) entity.description = dto.description;
    if (dto.allowCustomValues !== undefined) entity.allowCustomValues = dto.allowCustomValues;
    if (dto.status !== undefined) entity.status = dto.status as CodeItemStatusCode;

    const saved = await this.codeTypeRepository.saveEntity(entity);
    await this.refreshTypeFromDatabaseSafe(normalizedType);

    await this.auditLogService?.record({
      module: CODES_AUDIT_META.MODULE,
      feature: CODES_AUDIT_META.FEATURES.TYPE_MANAGEMENT,
      action: CODES_AUDIT_META.ACTIONS.UPDATE_TYPE,
      resourceType: 'code_type',
      resourceId: normalizedType,
      beforeData: beforeSnapshot,
      afterData: {
        name: saved.name,
        description: saved.description,
        allowCustomValues: saved.allowCustomValues,
        status: saved.status,
      },
      reason: `Updated code type ${normalizedType}`,
    });

    return this.toCodeTypeSummary(saved, { includeValues: true });
  }

  /** Đồng bộ idempotent toàn bộ `codeTypes` từ `module.manifest.json` vào DB và L1 Cache */
  public async syncManifests(
    customCodeTypes?: readonly CodeTypeManifestItem[],
  ): Promise<SyncCodesResult> {
    if (customCodeTypes && customCodeTypes.length > 0) {
      for (const ct of customCodeTypes) {
        const normalized = ct.code.trim().toLowerCase();
        this.manifestCodeTypes.set(normalized, {
          ...ct,
          code: normalized,
          module: (ct.module ?? normalized.split('.')[0] ?? 'core').trim().toLowerCase(),
        });
      }
    }

    const result = await syncDeclaredCodeTypesAndValuesToDatabase({
      allDeclared: [...this.manifestCodeTypes.values()],
      codeTypeRepository: this.codeTypeRepository,
      codeValueRepository: this.codeValueRepository,
      registry: this.registry,
      manifestCodeTypes: this.manifestCodeTypes,
    });

    await this.auditLogService?.record({
      module: CODES_AUDIT_META.MODULE,
      feature: CODES_AUDIT_META.FEATURES.LOOKUP_SYNC,
      action: CODES_AUDIT_META.ACTIONS.SYNC_MANIFESTS,
      resourceType: 'code_type',
      resourceId: 'ALL',
      beforeData: null,
      afterData: result as unknown as Record<string, unknown>,
      reason: 'Synchronized code_types and code_values from module manifests',
    });

    return result;
  }

  /** Tạo mới một giá trị danh mục động (`code_values`) trong nhóm `typeCode` */
  public async createCodeValue(
    typeCode: string,
    dto: CreateCodeValueRequest,
  ): Promise<ResolvedCodeValueView> {
    const normalizedType = typeCode.trim().toLowerCase();
    const codeType = await this.ensureCodeTypeExists(normalizedType);

    if (!codeType.allowCustomValues) {
      throw new ForbiddenAppException('codes.customValuesNotAllowed', [
        { typeCode: normalizedType },
      ]);
    }

    const existingValues = await this.codeValueRepository.findByTypeCode(normalizedType, true);
    const normalizedValueCode = dto.code.trim().toUpperCase();

    const duplicateByCode = existingValues.find(
      (v) => v.code.trim().toUpperCase() === normalizedValueCode,
    );
    if (duplicateByCode) {
      throw new ConflictAppException(
        'codes.duplicateValueCode',
        [{ typeCode: normalizedType, code: normalizedValueCode }],
        { typeCode: normalizedType, code: normalizedValueCode },
        HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
      );
    }

    const maxNumeric = existingValues.reduce(
      (max, item) => Math.max(max, Number(item.numericCode)),
      0,
    );
    const targetNumericCode = dto.numericCode ?? maxNumeric + 1;

    const duplicateByNumeric = existingValues.find(
      (v) => Number(v.numericCode) === targetNumericCode,
    );
    if (duplicateByNumeric) {
      throw new ConflictAppException(
        'codes.duplicateNumericCode',
        [{ typeCode: normalizedType, numericCode: targetNumericCode }],
        { typeCode: normalizedType, numericCode: targetNumericCode },
        HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
      );
    }

    const behaviorCode = dto.behaviorCode ? dto.behaviorCode.trim().toUpperCase() : null;
    const saved = await this.codeValueRepository.saveEntity({
      typeCode: normalizedType,
      numericCode: targetNumericCode,
      code: normalizedValueCode,
      behaviorCode,
      name: dto.name.trim(),
      description: dto.description ?? null,
      labelsJson: dto.labels ? JSON.stringify(dto.labels) : null,
      aliasesJson: dto.aliases ? JSON.stringify(dto.aliases) : null,
      color: dto.color ?? null,
      icon: dto.icon ?? null,
      sortOrder: dto.sortOrder ?? targetNumericCode,
      isDefault: dto.isDefault ?? false,
      isSystem: false,
      metadataJson: dto.metadata ? JSON.stringify(dto.metadata) : null,
      status: (dto.status ?? CODE_ITEM_STATUS.ACTIVE) as CodeItemStatusCode,
    });

    const view = this.syncEntityValueToRegistry(saved);

    await this.auditLogService?.record({
      module: CODES_AUDIT_META.MODULE,
      feature: CODES_AUDIT_META.FEATURES.VALUE_MANAGEMENT,
      action: CODES_AUDIT_META.ACTIONS.CREATE_VALUE,
      resourceType: 'code_value',
      resourceId: `${normalizedType}:${saved.numericCode}`,
      beforeData: null,
      afterData: {
        typeCode: normalizedType,
        numericCode: saved.numericCode,
        code: saved.code,
        behaviorCode: saved.behaviorCode,
        name: saved.name,
        labels: dto.labels ?? {},
      },
      reason: `Created dynamic code value ${saved.code} (${saved.numericCode}) in ${normalizedType}`,
    });

    return view;
  }

  /** Cập nhật nhãn đa ngôn ngữ, từ đồng nghĩa, màu sắc, thứ tự hoặc trạng thái của một giá trị danh mục */
  public async updateCodeValue(
    typeCode: string,
    numericCode: number,
    dto: UpdateCodeValueRequest,
  ): Promise<ResolvedCodeValueView> {
    const normalizedType = typeCode.trim().toLowerCase();
    const entity = await this.ensureCodeValueExists(normalizedType, numericCode);

    if (entity.isSystem && dto.status === CODE_ITEM_STATUS.INACTIVE) {
      throw new ForbiddenAppException('codes.cannotDeactivateSystemAnchor', [
        { typeCode: normalizedType, code: entity.code },
      ]);
    }

    if (dto.code !== undefined) {
      await validateCodeValueCodeChange({
        normalizedType,
        numericCode,
        entity,
        rawNextCode: dto.code,
        registry: this.registry,
        codeValueRepository: this.codeValueRepository,
      });
    }

    const beforeSnapshot = {
      code: entity.code,
      name: entity.name,
      description: entity.description,
      behaviorCode: entity.behaviorCode,
      labelsJson: entity.labelsJson,
      aliasesJson: entity.aliasesJson,
      color: entity.color,
      icon: entity.icon,
      sortOrder: entity.sortOrder,
      isDefault: entity.isDefault,
      status: entity.status,
    };

    applyCodeValueUpdatesToEntity(entity, dto);

    const saved = await this.codeValueRepository.saveEntity(entity);
    const view = this.syncEntityValueToRegistry(saved);

    await this.auditLogService?.record({
      module: CODES_AUDIT_META.MODULE,
      feature: CODES_AUDIT_META.FEATURES.VALUE_MANAGEMENT,
      action: CODES_AUDIT_META.ACTIONS.UPDATE_VALUE,
      resourceType: 'code_value',
      resourceId: `${normalizedType}:${saved.numericCode}`,
      beforeData: beforeSnapshot,
      afterData: {
        name: saved.name,
        description: saved.description,
        behaviorCode: saved.behaviorCode,
        labelsJson: saved.labelsJson,
        aliasesJson: saved.aliasesJson,
        color: saved.color,
        icon: saved.icon,
        sortOrder: saved.sortOrder,
        isDefault: saved.isDefault,
        status: saved.status,
      },
      reason: `Updated code value ${saved.code} (${saved.numericCode}) in ${normalizedType}`,
    });

    return view;
  }

  /** Sắp xếp lại thứ tự hiển thị (`sortOrder`) cho các mục danh mục trong nhóm `typeCode` (Mục 5.4.3) */
  public async reorderCodeValues(
    typeCode: string,
    dto: ReorderCodeValuesRequest,
  ): Promise<ResolvedCodeValueView[]> {
    const normalizedType = typeCode.trim().toLowerCase();
    await this.ensureCodeTypeExists(normalizedType);

    for (const item of dto.items) {
      const entity = await this.ensureCodeValueExists(normalizedType, item.numericCode);
      entity.sortOrder = item.sortOrder;
      const saved = await this.codeValueRepository.saveEntity(entity);
      this.syncEntityValueToRegistry(saved);
    }

    await this.auditLogService?.record({
      module: CODES_AUDIT_META.MODULE,
      feature: CODES_AUDIT_META.FEATURES.VALUE_MANAGEMENT,
      action: CODES_AUDIT_META.ACTIONS.REORDER_VALUES,
      resourceType: 'code_type',
      resourceId: normalizedType,
      beforeData: null,
      afterData: { items: dto.items },
      reason: `Reordered ${dto.items.length} code values in ${normalizedType}`,
    });

    return this.listCodeValues(normalizedType, { includeInactive: true });
  }

  /** Kiểm tra xem một mục danh mục đang được sử dụng bởi bao nhiêu bản ghi nghiệp vụ liên quan (Mục 5.4.8) */
  public async checkCodeValueUsage(
    typeCode: string,
    numericCode: number,
  ): Promise<CodeValueUsageCheckResult> {
    const normalizedType = typeCode.trim().toLowerCase();
    const entity = await this.ensureCodeValueExists(normalizedType, numericCode);
    return this.registry.checkValueUsage(normalizedType, numericCode, entity.code);
  }

  /** Xóa mềm giá trị danh mục động (Chặn xóa nếu `isSystem = true` hoặc đang được sử dụng `inUse = true` — Mục 5.4.8) */
  public async removeCodeValue(
    typeCode: string,
    numericCode: number,
  ): Promise<{ deleted: true; typeCode: string; numericCode: number; code: string }> {
    const normalizedType = typeCode.trim().toLowerCase();
    const entity = await this.ensureCodeValueExists(normalizedType, numericCode);

    if (entity.isSystem) {
      throw new ForbiddenAppException('codes.cannotDeleteSystemValue', [
        { typeCode: normalizedType, numericCode, code: entity.code },
      ]);
    }

    const usage = await this.registry.checkValueUsage(normalizedType, numericCode, entity.code);
    if (usage.inUse) {
      throw new ConflictAppException(
        'codes.valueInUse',
        [
          {
            typeCode: normalizedType,
            numericCode,
            code: entity.code,
            usageCount: usage.totalUsageCount,
            details: usage.details,
          },
        ],
        {
          typeCode: normalizedType,
          numericCode,
          code: entity.code,
          usageCount: usage.totalUsageCount,
        },
        HTTP_ERROR_CODE.CONFLICT,
      );
    }

    const code = entity.code;
    await this.codeValueRepository.repository.softDelete(entity.id);
    this.registry.removeValue(normalizedType, numericCode);

    await this.auditLogService?.record({
      module: CODES_AUDIT_META.MODULE,
      feature: CODES_AUDIT_META.FEATURES.VALUE_MANAGEMENT,
      action: CODES_AUDIT_META.ACTIONS.DELETE_VALUE,
      resourceType: 'code_value',
      resourceId: `${normalizedType}:${numericCode}`,
      beforeData: {
        typeCode: normalizedType,
        numericCode,
        code,
        name: entity.name,
      },
      afterData: { deleted: true },
      reason: `Deleted custom code value ${code} (${numericCode}) from ${normalizedType}`,
    });

    return {
      deleted: true,
      typeCode: normalizedType,
      numericCode,
      code,
    };
  }

  /** Nhập danh mục hàng loạt từ Excel (.xlsx Base64), CSV hoặc JSON có kiểm tra trùng mã (Mục 5.4.6) */
  public async bulkImportCodeValues(
    dto: BulkImportCodesRequest,
    routeTypeCode?: string,
  ): Promise<BulkImportCodesResultResponse> {
    const fallbackTypeCode = (routeTypeCode ?? dto.typeCode ?? '').trim().toLowerCase();
    const result = await executeBulkImportCodeValues({
      dto,
      fallbackTypeCode,
      codeTypeRepository: this.codeTypeRepository,
      codeValueRepository: this.codeValueRepository,
      manifestCodeTypes: this.manifestCodeTypes,
      registry: this.registry,
      settingRegistry: this.settingRegistry,
      syncManifests: () => this.syncManifests(),
      createCodeValue: (typeCode, payload) => this.createCodeValue(typeCode, payload),
    });

    await this.auditLogService?.record({
      module: CODES_AUDIT_META.MODULE,
      feature: CODES_AUDIT_META.FEATURES.IMPORT,
      action: CODES_AUDIT_META.ACTIONS.BULK_IMPORT,
      resourceType: 'code_value',
      resourceId: fallbackTypeCode || 'ALL',
      beforeData: null,
      afterData: {
        totalRows: result.totalRows,
        importedCount: result.importedCount,
        skippedCount: result.skippedCount,
        failedCount: result.failedCount,
      },
      reason: `Imported ${result.importedCount}/${result.totalRows} master data code values`,
    });

    return result;
  }

  /** Xuất danh mục dùng chung ra Excel (.xlsx) hoặc CSV (.csv) phục vụ quản trị (Mục 5.4.7) */
  public async exportCodes(query: Partial<ExportCodesQuery> = {}): Promise<ExportCodesResponse> {
    const locale = this.resolveEffectiveLocale();
    const allTypes = await this.listCodeTypes({
      module: query.module,
      includeValues: true,
      locale,
    });

    const response = buildCodesExportPayload({
      registry: this.registry,
      settingRegistry: this.settingRegistry,
      allTypes,
      query,
      locale,
    });

    await this.auditLogService?.record({
      module: CODES_AUDIT_META.MODULE,
      feature: CODES_AUDIT_META.FEATURES.EXPORT,
      action: CODES_AUDIT_META.ACTIONS.EXPORT,
      resourceType: 'code_export',
      resourceId: response.fileName,
      beforeData: null,
      afterData: {
        fileName: response.fileName,
        format: response.format,
        totalExported: response.totalExported,
        module: query.module ?? null,
        typeCode: query.typeCode ?? null,
      },
      reason: `Exported ${response.totalExported} master data items as ${response.format.toUpperCase()}`,
    });

    return response;
  }

  /** Xuất file mẫu (Template) Excel (.xlsx) hoặc CSV (.csv) phục vụ Import danh mục (Mục 5.4.6) */
  public exportImportTemplate(format: 'csv' | 'xlsx' = 'xlsx'): ExportCodesResponse {
    return buildCodesImportTemplatePayload(this.registry, format, this.resolveEffectiveLocale());
  }

  private configureI18nBridge(): void {
    this.registry.setI18nResolver((typeCode: string, valueCode: string, locale: string) => {
      if (!this.i18nService) return undefined;
      const parts = typeCode.split('.');
      const moduleName = parts[0] ?? 'core';
      const shortType = parts.slice(1).join('.');
      const key = `${moduleName}.codes.${shortType}.${valueCode}`;
      const supportedLocale: SupportedLocale = isSupportedLocale(locale)
        ? locale
        : resolveSystemDefaultLocale();
      const translated = this.i18nService.t(key, {}, supportedLocale);
      return translated && translated !== key ? translated : undefined;
    });
  }

  private discoverManifestCodeTypes(): void {
    for (const item of discoverManifestCodeTypes()) {
      this.manifestCodeTypes.set(item.code.trim().toLowerCase(), item);
    }
    this.registry.registerManifestTypes([...this.manifestCodeTypes.values()]);
  }

  private async ensureCodeTypeExists(typeCode: string): Promise<CodeTypeEntity> {
    const normalized = typeCode.trim().toLowerCase();
    let entity = await this.codeTypeRepository.findByCode(normalized);
    if (!entity && this.manifestCodeTypes.has(normalized)) {
      await this.syncManifests();
      entity = await this.codeTypeRepository.findByCode(normalized);
    }
    if (!entity) {
      throw new NotFoundAppException('codes.typeNotFound', { typeCode: normalized });
    }
    return entity;
  }

  private async ensureCodeValueExists(
    typeCode: string,
    numericCode: number,
  ): Promise<CodeValueEntity> {
    const normalized = typeCode.trim().toLowerCase();
    await this.ensureCodeTypeExists(normalized);

    let entity = await this.codeValueRepository.findByTypeAndNumericCode(normalized, numericCode);
    if (!entity && this.registry.isValidNumericCode(normalized, numericCode, true)) {
      await this.syncManifests();
      entity = await this.codeValueRepository.findByTypeAndNumericCode(normalized, numericCode);
    }
    if (!entity) {
      throw new NotFoundAppException('codes.valueNotFound', {
        typeCode: normalized,
        numericCode,
      });
    }
    return entity;
  }

  private toCodeTypeSummary(
    ct: CodeTypeEntity,
    options?: CodeTypeSummaryBuildOptions,
  ): CodeTypeSummary {
    const locale = this.resolveEffectiveLocale(options?.locale);
    return mapEntityToCodeTypeSummary(ct, this.registry, locale, options);
  }

  private async findDbCodeTypesSafe(query: ListCodeTypesQuery): Promise<CodeTypeEntity[]> {
    try {
      return await this.codeTypeRepository.findFiltered({
        module: query.module,
        search: query.search,
      });
    } catch {
      return [];
    }
  }

  private async refreshRegistryFromDatabaseSafe(): Promise<void> {
    await refreshCodeRegistryFromDatabase({
      codeTypeRepository: this.codeTypeRepository,
      codeValueRepository: this.codeValueRepository,
      registry: this.registry,
      manifestCodeTypes: this.manifestCodeTypes,
    });
  }

  private async refreshTypeFromDatabaseSafe(typeCode: string): Promise<void> {
    await refreshSingleCodeTypeFromDatabase({
      typeCode,
      codeTypeRepository: this.codeTypeRepository,
      codeValueRepository: this.codeValueRepository,
      registry: this.registry,
      manifestCodeTypes: this.manifestCodeTypes,
    });
  }

  private syncEntityValueToRegistry(entity: CodeValueEntity): ResolvedCodeValueView {
    const locale = this.resolveEffectiveLocale();
    return this.registry.upsertValue(
      entity.typeCode,
      mapCodeValueEntityToManifestItem(entity, this.manifestCodeTypes),
      locale,
    );
  }

  private resolveEffectiveLocale(requestedLocale?: string): string {
    if (requestedLocale && requestedLocale.trim()) {
      return requestedLocale.trim().toLowerCase();
    }
    return this.i18nService?.getCurrentLocale() ?? resolveSystemDefaultLocale();
  }
}

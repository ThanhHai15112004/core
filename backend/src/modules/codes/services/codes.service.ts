import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  CODE_ITEM_STATUS,
  type CodeItemStatusCode,
  CodeRegistryService,
  type CodeTypeManifestItem,
  type CodeValueManifestItem,
  type CodeValueUsageCheckResult,
  ConflictAppException,
  ForbiddenAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
  type ResolvedCodeValueView,
  buildCsvContent,
  buildXlsxBuffer,
  cleanSpreadsheetCell,
  createSpreadsheetColumnFinder,
  defaultCodeRegistry,
  detectSpreadsheetHeaderRowIndex,
  discoverManifestCodeTypes,
  parseCsvToMatrix,
  parseXlsxToMatrix,
} from '@packages/kernel/index.js';
import { CoreI18nService, LocaleContext, LocaleFormatter } from '@packages/i18n/index.js';
import { AuditLogService } from '@packages/security/index.js';
import type { CodeTypeSummary, ICodesPublicService, SyncCodesResult } from '../contracts/index.js';
import type { CodeTypeEntity } from '../entities/code-type.entity.js';
import type { CodeValueEntity } from '../entities/code-value.entity.js';
import { CodeTypeRepository } from '../repositories/code-type.repository.js';
import { CodeValueRepository } from '../repositories/code-value.repository.js';
import {
  type BootstrapCodesQuery,
  type BulkImportCodeValueRowInput,
  type BulkImportCodesRequest,
  type CreateCodeTypeRequest,
  type CreateCodeValueRequest,
  type ExportCodesQuery,
  type ListCodeTypesQuery,
  type ListCodeValuesQuery,
  type ReorderCodeValuesRequest,
  type UpdateCodeTypeRequest,
  type UpdateCodeValueRequest,
  bulkImportCodeValueRowSchema,
} from '../requests/codes.requests.js';
import type {
  BulkImportCodesResultResponse,
  ExportCodesResponse,
} from '../responses/codes.response.js';

const CODES_EXPORT_HEADERS = [
  'STT',
  'Mã nhóm danh mục',
  'Tên nhóm danh mục',
  'Mã số',
  'Mã mục',
  'Mã hành vi',
  'Tên hiển thị (VI)',
  'Tên tiếng Anh (EN)',
  'Từ đồng nghĩa',
  'Thứ tự',
  'Trạng thái',
  'Nguồn',
] as const;

@Injectable()
export class CodesService implements ICodesPublicService, OnModuleInit {
  private readonly manifestCodeTypes = new Map<string, CodeTypeManifestItem>();
  private readonly registry: CodeRegistryService;

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
  ) {
    this.registry = codeRegistryService ?? defaultCodeRegistry;
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

  /** Tạo mới một nhóm danh mục dùng chung (`code_types` — Mục 5.4.1: loại hồ sơ, trạng thái, khu vực...) */
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
      module: 'codes',
      feature: 'code-type-management',
      action: 'codes.type.create',
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
      module: 'codes',
      feature: 'code-type-management',
      action: 'codes.type.update',
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

    const allDeclared = [...this.manifestCodeTypes.values()];
    this.registry.registerManifestTypes(allDeclared);

    const syncedModules = new Set<string>();
    let createdTypesCount = 0;
    let updatedTypesCount = 0;
    let totalCodeValues = 0;
    let createdValuesCount = 0;
    let updatedValuesCount = 0;

    for (const declared of allDeclared) {
      const typeCode = declared.code.trim().toLowerCase();
      const moduleName = (declared.module ?? typeCode.split('.')[0] ?? 'core').trim().toLowerCase();
      syncedModules.add(moduleName);

      const existingType = await this.codeTypeRepository.findByCode(typeCode);
      if (!existingType) {
        await this.codeTypeRepository.saveEntity({
          code: typeCode,
          module: moduleName,
          name: declared.name.trim(),
          description: declared.description ?? null,
          isSystem: declared.isSystem ?? true,
          allowCustomValues: declared.allowCustomValues ?? true,
          status: CODE_ITEM_STATUS.ACTIVE,
        });
        createdTypesCount++;
      } else {
        existingType.module = moduleName;
        existingType.name = declared.name.trim();
        if (declared.description !== undefined) {
          existingType.description = declared.description;
        }
        existingType.isSystem = declared.isSystem ?? existingType.isSystem;
        existingType.allowCustomValues =
          declared.allowCustomValues ?? existingType.allowCustomValues;
        await this.codeTypeRepository.saveEntity(existingType);
        updatedTypesCount++;
      }

      const existingValues = await this.codeValueRepository.findByTypeCode(typeCode, true);
      const byNumeric = new Map<number, CodeValueEntity>(
        existingValues.map((v) => [Number(v.numericCode), v]),
      );

      for (const val of declared.values ?? []) {
        totalCodeValues++;
        const existingVal = byNumeric.get(Number(val.numericCode));
        const normalizedCode = val.code.trim().toUpperCase();
        const normalizedBehavior = val.behaviorCode ? val.behaviorCode.trim().toUpperCase() : null;

        if (!existingVal) {
          await this.codeValueRepository.saveEntity({
            typeCode,
            numericCode: Number(val.numericCode),
            code: normalizedCode,
            behaviorCode: normalizedBehavior,
            name: val.name.trim(),
            description: val.description ?? null,
            labelsJson: val.labels ? JSON.stringify(val.labels) : null,
            aliasesJson: val.aliases ? JSON.stringify(val.aliases) : null,
            color: val.color ?? null,
            icon: val.icon ?? null,
            sortOrder: val.sortOrder ?? val.numericCode,
            isDefault: val.isDefault ?? false,
            isSystem: val.isSystem ?? true,
            metadataJson: val.metadata ? JSON.stringify(val.metadata) : null,
            status:
              val.status === CODE_ITEM_STATUS.INACTIVE
                ? CODE_ITEM_STATUS.INACTIVE
                : CODE_ITEM_STATUS.ACTIVE,
          });
          createdValuesCount++;
        } else {
          // Preserve custom Admin labels/aliases/color/icon if already customized in DB
          existingVal.code = normalizedCode;
          existingVal.behaviorCode = normalizedBehavior ?? existingVal.behaviorCode ?? null;
          if (!existingVal.labelsJson && val.labels) {
            existingVal.labelsJson = JSON.stringify(val.labels);
          }
          if (!existingVal.aliasesJson && val.aliases) {
            existingVal.aliasesJson = JSON.stringify(val.aliases);
          }
          if (!existingVal.color && val.color) {
            existingVal.color = val.color;
          }
          if (!existingVal.icon && val.icon) {
            existingVal.icon = val.icon;
          }
          if (!existingVal.metadataJson && val.metadata) {
            existingVal.metadataJson = JSON.stringify(val.metadata);
          }
          existingVal.isSystem = val.isSystem ?? existingVal.isSystem;
          await this.codeValueRepository.saveEntity(existingVal);
          updatedValuesCount++;
        }
      }

      await this.refreshTypeFromDatabaseSafe(typeCode);
    }

    const result: SyncCodesResult = {
      syncedModules: [...syncedModules].sort(),
      totalCodeTypes: allDeclared.length,
      createdTypesCount,
      updatedTypesCount,
      totalCodeValues,
      createdValuesCount,
      updatedValuesCount,
    };

    await this.auditLogService?.record({
      module: 'codes',
      feature: 'code-lookup-sync',
      action: 'codes.sync_manifests',
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
      module: 'codes',
      feature: 'code-value-management',
      action: 'codes.value.create',
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
      const nextCode = dto.code.trim().toUpperCase();
      if (nextCode !== entity.code.trim().toUpperCase()) {
        if (entity.isSystem) {
          throw new ForbiddenAppException('codes.cannotChangeSystemCode', [
            { typeCode: normalizedType, code: entity.code },
          ]);
        }

        const usage = await this.registry.checkValueUsage(normalizedType, numericCode, entity.code);
        if (usage.inUse) {
          throw new ConflictAppException(
            'codes.cannotChangeCodeInUse',
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

        const existingValues = await this.codeValueRepository.findByTypeCode(normalizedType, true);
        const duplicate = existingValues.find(
          (v) =>
            Number(v.numericCode) !== Number(numericCode) &&
            v.code.trim().toUpperCase() === nextCode,
        );
        if (duplicate) {
          throw new ConflictAppException(
            'codes.duplicateValueCode',
            [{ typeCode: normalizedType, code: nextCode }],
            { typeCode: normalizedType, code: nextCode },
            HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
          );
        }
      }
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

    if (dto.code !== undefined) {
      entity.code = dto.code.trim().toUpperCase();
    }

    if (dto.name !== undefined) {
      entity.name = dto.name.trim();
      const existingLabels = this.parseJsonObject<Record<string, string>>(entity.labelsJson, {});
      if (dto.labels?.vi === undefined) {
        existingLabels.vi = entity.name;
        entity.labelsJson = JSON.stringify(existingLabels);
      }
    }
    if (dto.description !== undefined) entity.description = dto.description;
    if (dto.behaviorCode !== undefined && !entity.isSystem) {
      entity.behaviorCode = dto.behaviorCode ? dto.behaviorCode.trim().toUpperCase() : null;
    }
    if (dto.labels !== undefined) {
      const existingLabels = this.parseJsonObject<Record<string, string>>(entity.labelsJson, {});
      entity.labelsJson = JSON.stringify({ ...existingLabels, ...dto.labels });
    }
    if (dto.aliases !== undefined) {
      entity.aliasesJson = JSON.stringify(dto.aliases);
    }
    if (dto.color !== undefined) entity.color = dto.color;
    if (dto.icon !== undefined) entity.icon = dto.icon;
    if (dto.sortOrder !== undefined) entity.sortOrder = dto.sortOrder;
    if (dto.isDefault !== undefined) entity.isDefault = dto.isDefault;
    if (dto.metadata !== undefined) {
      entity.metadataJson = dto.metadata ? JSON.stringify(dto.metadata) : null;
    }
    if (dto.status !== undefined) {
      entity.status = dto.status as CodeItemStatusCode;
    }

    const saved = await this.codeValueRepository.saveEntity(entity);
    const view = this.syncEntityValueToRegistry(saved);

    await this.auditLogService?.record({
      module: 'codes',
      feature: 'code-value-management',
      action: 'codes.value.update',
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
      module: 'codes',
      feature: 'code-value-management',
      action: 'codes.value.reorder',
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
      module: 'codes',
      feature: 'code-value-management',
      action: 'codes.value.delete',
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
    let rawRows: BulkImportCodeValueRowInput[];

    if (dto.xlsxBase64) {
      try {
        const matrix = parseXlsxToMatrix(dto.xlsxBase64);
        rawRows = this.mapMatrixToImportRows(matrix, fallbackTypeCode);
      } catch (err: unknown) {
        throw new BadRequestAppException('codes.invalidXlsxFile', [
          err instanceof Error ? err.message : 'Unable to parse .xlsx file',
        ]);
      }
    } else if (dto.csvContent) {
      const matrix = parseCsvToMatrix(dto.csvContent);
      rawRows = this.mapMatrixToImportRows(matrix, fallbackTypeCode);
    } else {
      rawRows = (dto.items ?? []).map((item) => ({
        ...item,
        typeCode: item.typeCode ?? (fallbackTypeCode || undefined),
      }));
    }

    const errors: Array<{ row: number; identifier: string; message: string }> = [];
    const importedCodes: string[] = [];
    let skippedCount = 0;

    // Bộ nhớ kiểm tra trùng mã ngay trong cùng 1 file import
    const seenCodesInBatch = new Set<string>();
    const seenNumericsInBatch = new Set<string>();

    for (let i = 0; i < rawRows.length; i++) {
      const rowNumber = i + 1;
      const raw = rawRows[i]!;
      const resolvedTypeCode = (raw.typeCode || fallbackTypeCode).trim().toLowerCase();
      const rawCode = (raw.code ?? '').trim().toUpperCase();
      const identifier = resolvedTypeCode
        ? `${resolvedTypeCode}:${rawCode || rowNumber}`
        : rawCode || `row-${rowNumber}`;

      if (!resolvedTypeCode) {
        errors.push({
          row: rowNumber,
          identifier,
          message: 'Missing typeCode for master data row',
        });
        continue;
      }

      const parsed = bulkImportCodeValueRowSchema.safeParse({
        ...raw,
        typeCode: resolvedTypeCode,
      });
      if (!parsed.success) {
        const msg = parsed.error.issues.map((iss) => iss.message).join('; ');
        errors.push({ row: rowNumber, identifier, message: msg });
        continue;
      }

      const validRow = parsed.data;
      const normalizedValueCode = validRow.code.trim().toUpperCase();
      const batchCodeKey = `${resolvedTypeCode}:${normalizedValueCode}`;

      // 1. Kiểm tra trùng mã `code` ngay trong file import
      if (seenCodesInBatch.has(batchCodeKey)) {
        if (dto.skipDuplicates) {
          skippedCount++;
          continue;
        }
        errors.push({
          row: rowNumber,
          identifier,
          message: `Duplicate value code in import payload: ${normalizedValueCode} (${resolvedTypeCode})`,
        });
        continue;
      }

      // 2. Kiểm tra trùng `numericCode` ngay trong file import (nếu có truyền)
      if (validRow.numericCode !== undefined) {
        const batchNumKey = `${resolvedTypeCode}:${validRow.numericCode}`;
        if (seenNumericsInBatch.has(batchNumKey)) {
          if (dto.skipDuplicates) {
            skippedCount++;
            continue;
          }
          errors.push({
            row: rowNumber,
            identifier,
            message: `Duplicate numericCode in import payload: ${validRow.numericCode} (${resolvedTypeCode})`,
          });
          continue;
        }
      }

      // 3. Đảm bảo nhóm danh mục tồn tại (nếu chưa có thì tự tạo nhóm Master Data mới)
      let codeType = await this.codeTypeRepository.findByCode(resolvedTypeCode);
      if (!codeType && this.manifestCodeTypes.has(resolvedTypeCode)) {
        await this.syncManifests();
        codeType = await this.codeTypeRepository.findByCode(resolvedTypeCode);
      }
      if (!codeType) {
        const inferredMod = resolvedTypeCode.includes('.')
          ? resolvedTypeCode.split('.')[0]!
          : 'common';
        codeType = await this.codeTypeRepository.saveEntity({
          code: resolvedTypeCode,
          module: inferredMod,
          name: validRow.typeName?.trim() || resolvedTypeCode,
          description: null,
          isSystem: false,
          allowCustomValues: true,
          status: CODE_ITEM_STATUS.ACTIVE,
        });
        this.registry.registerCodeType({
          id: Number(codeType.id),
          code: codeType.code,
          module: codeType.module,
          name: codeType.name,
          isSystem: false,
          allowCustomValues: true,
          status: CODE_ITEM_STATUS.ACTIVE,
        });
      }

      if (!codeType.allowCustomValues) {
        errors.push({
          row: rowNumber,
          identifier,
          message: `Code type '${resolvedTypeCode}' does not allow custom values`,
        });
        continue;
      }

      // 4. Kiểm tra trùng mã `code` hoặc `numericCode` với dữ liệu đã có trong DB
      const existingValues = await this.codeValueRepository.findByTypeCode(resolvedTypeCode, true);
      const dupByCode = existingValues.find(
        (v) => v.code.trim().toUpperCase() === normalizedValueCode,
      );
      const dupByNumeric =
        validRow.numericCode !== undefined
          ? existingValues.find((v) => Number(v.numericCode) === Number(validRow.numericCode))
          : undefined;

      if (dupByCode || dupByNumeric) {
        if (dto.skipDuplicates) {
          skippedCount++;
          continue;
        }
        errors.push({
          row: rowNumber,
          identifier,
          message: dupByCode
            ? `Duplicate value code in database: ${normalizedValueCode} (${resolvedTypeCode})`
            : `Duplicate numericCode in database: ${validRow.numericCode} (${resolvedTypeCode})`,
        });
        continue;
      }

      seenCodesInBatch.add(batchCodeKey);
      if (validRow.numericCode !== undefined) {
        seenNumericsInBatch.add(`${resolvedTypeCode}:${validRow.numericCode}`);
      }

      try {
        const created = await this.createCodeValue(resolvedTypeCode, {
          numericCode: validRow.numericCode,
          code: normalizedValueCode,
          behaviorCode: validRow.behaviorCode ?? normalizedValueCode,
          name: validRow.name,
          description: validRow.description ?? null,
          labels: validRow.labels ?? { vi: validRow.name },
          aliases: validRow.aliases,
          color: validRow.color ?? null,
          icon: validRow.icon ?? null,
          sortOrder: validRow.sortOrder,
          isDefault: validRow.isDefault,
          status: validRow.status ?? CODE_ITEM_STATUS.ACTIVE,
        });
        importedCodes.push(`${resolvedTypeCode}:${created.code}`);
      } catch (err: unknown) {
        errors.push({
          row: rowNumber,
          identifier,
          message: err instanceof Error ? err.message : 'Failed to import code value',
        });
      }
    }

    await this.auditLogService?.record({
      module: 'codes',
      feature: 'code-import',
      action: 'codes.value.bulk_import',
      resourceType: 'code_value',
      resourceId: fallbackTypeCode || 'ALL',
      beforeData: null,
      afterData: {
        totalRows: rawRows.length,
        importedCount: importedCodes.length,
        skippedCount,
        failedCount: errors.length,
      },
      reason: `Imported ${importedCodes.length}/${rawRows.length} master data code values`,
    });

    return {
      totalRows: rawRows.length,
      importedCount: importedCodes.length,
      skippedCount,
      failedCount: errors.length,
      importedCodes,
      errors,
    };
  }

  /** Xuất danh mục dùng chung ra Excel (.xlsx) hoặc CSV (.csv) phục vụ quản trị (Mục 5.4.7) */
  public async exportCodes(query: Partial<ExportCodesQuery> = {}): Promise<ExportCodesResponse> {
    const format: 'csv' | 'xlsx' = query.format === 'xlsx' ? 'xlsx' : 'csv';
    const includeInactive = query.includeInactive ?? true;

    const allTypes = await this.listCodeTypes({
      module: query.module,
      includeValues: true,
      locale: 'vi',
    });

    const filteredTypes = query.typeCode
      ? allTypes.filter((t) => t.code.toLowerCase() === query.typeCode!.trim().toLowerCase())
      : allTypes;

    const matrixRows: Array<Array<string | number>> = [];
    let stt = 0;

    for (const ct of filteredTypes) {
      const values = this.registry.listValues(ct.code, {
        includeInactive,
        locale: 'vi',
      });
      for (const val of values) {
        stt++;
        matrixRows.push(this.formatCodeExportRow(stt, ct.code, ct.name, val));
      }
    }

    const effectiveTimezone = LocaleFormatter.resolveActiveTimezone(LocaleContext.getTimezone());
    const reportTitle = query.title?.trim() || 'DANH MỤC DÙNG CHUNG HỆ THỐNG (MASTER DATA)';
    const exportedAtSubtitle = `Ngày xuất dữ liệu: ${LocaleFormatter.formatReportDateTime(new Date(), effectiveTimezone)}`;

    const csvContent = buildCsvContent(CODES_EXPORT_HEADERS, matrixRows);
    const xlsxBuffer = buildXlsxBuffer(CODES_EXPORT_HEADERS, matrixRows, {
      sheetName: 'MasterData',
      title: reportTitle,
      subtitle: exportedAtSubtitle,
      logoPng: query.logoBase64 ?? null,
      centerColumnIndices: [0, 3, 9, 10, 11],
      textColumnIndices: [1, 4, 5],
      freezeHeader: true,
    });

    const datePart = new Date().toISOString().slice(0, 10);
    const fileName = `danh_muc_dung_chung_${datePart}.${format}`;

    await this.auditLogService?.record({
      module: 'codes',
      feature: 'code-export',
      action: 'codes.export',
      resourceType: 'code_export',
      resourceId: fileName,
      beforeData: null,
      afterData: {
        fileName,
        format,
        totalExported: matrixRows.length,
        module: query.module ?? null,
        typeCode: query.typeCode ?? null,
      },
      reason: `Exported ${matrixRows.length} master data items as ${format.toUpperCase()}`,
    });

    return {
      fileName,
      contentType:
        format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv; charset=utf-8',
      format,
      totalExported: matrixRows.length,
      csvContent,
      xlsxBase64: xlsxBuffer.toString('base64'),
    };
  }

  /** Xuất file mẫu (Template) Excel (.xlsx) hoặc CSV (.csv) phục vụ Import danh mục (Mục 5.4.6 — lấy mẫu từ dữ liệu đã seed trong Registry) */
  public exportImportTemplate(format: 'csv' | 'xlsx' = 'xlsx'): ExportCodesResponse {
    const sampleType =
      this.registry.getType('codes.region') ?? this.registry.listTypes()[0] ?? null;
    const sampleValues = sampleType
      ? this.registry
          .listValues(sampleType.code, { includeInactive: true, locale: 'vi' })
          .slice(0, 2)
      : [];

    const sampleRows: Array<Array<string | number>> = sampleValues.map((val, idx) =>
      this.formatCodeExportRow(idx + 1, sampleType!.code, sampleType!.name, val),
    );

    const csvContent = buildCsvContent(CODES_EXPORT_HEADERS, sampleRows);
    const xlsxBase64 = buildXlsxBuffer(CODES_EXPORT_HEADERS, sampleRows, {
      sheetName: 'MasterDataTemplate',
      centerColumnIndices: [0, 3, 9, 10, 11],
      textColumnIndices: [1, 4, 5],
      freezeHeader: true,
    }).toString('base64');

    return {
      fileName: `mau_import_danh_muc.${format}`,
      contentType:
        format === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv; charset=utf-8',
      format,
      totalExported: sampleRows.length,
      csvContent,
      xlsxBase64,
    };
  }

  /** Chuyển ma trận 2 chiều từ Excel/CSV sang danh sách `BulkImportCodeValueRowInput` */
  private mapMatrixToImportRows(
    matrix: ReadonlyArray<ReadonlyArray<string>>,
    fallbackTypeCode = '',
  ): BulkImportCodeValueRowInput[] {
    if (matrix.length < 2) return [];

    const headerRowIdx = detectSpreadsheetHeaderRowIndex(matrix, [
      'mã mục',
      'ma muc',
      'code',
      'value_code',
      'mã nhóm danh mục',
      'ma nhom danh muc',
      'type_code',
      'typecode',
      'tên hiển thị',
      'ten hien thi',
      'name',
    ]);

    if (headerRowIdx >= matrix.length - 1) return [];
    const idxOf = createSpreadsheetColumnFinder(matrix[headerRowIdx]!);

    const typeCodeIdx = idxOf([
      'mã nhóm danh mục',
      'ma nhom danh muc',
      'typecode',
      'type_code',
      'nhóm danh mục',
    ]);
    const typeNameIdx = idxOf(['tên nhóm danh mục', 'ten nhom danh muc', 'typename', 'type_name']);
    const numericIdx = idxOf(['mã số', 'ma so', 'numericcode', 'numeric_code']);
    const codeIdx = idxOf(['mã mục', 'ma muc', 'code', 'value_code', 'mã danh mục']);
    const behaviorIdx = idxOf(['mã hành vi', 'ma hanh vi', 'behaviorcode', 'behavior_code']);
    const nameViIdx = idxOf(['tên hiển thị', 'ten hien thi', 'name', 'tên mục', 'label_vi', 'vi']);
    const nameEnIdx = idxOf(['tên tiếng anh', 'ten tieng anh', 'label_en', 'en', 'english']);
    const aliasesIdx = idxOf(['từ đồng nghĩa', 'tu dong nghia', 'aliases', 'alias']);
    const sortOrderIdx = idxOf(['thứ tự', 'thu tu', 'sortorder', 'sort_order']);
    const statusIdx = idxOf(['trạng thái', 'trang thai', 'status']);

    const rows: BulkImportCodeValueRowInput[] = [];
    for (let i = headerRowIdx + 1; i < matrix.length; i++) {
      const cells = matrix[i]!;
      const getCell = (idx: number): string =>
        idx >= 0 ? cleanSpreadsheetCell(cells[idx] ?? '') : '';

      const code = getCell(codeIdx).toUpperCase();
      const nameVi = getCell(nameViIdx);
      if (!code && !nameVi) continue;

      const typeCode = (getCell(typeCodeIdx) || fallbackTypeCode).toLowerCase();
      const typeName = getCell(typeNameIdx) || undefined;
      const rawNumeric = getCell(numericIdx);
      const numericCode =
        rawNumeric && Number.isInteger(Number(rawNumeric)) && Number(rawNumeric) > 0
          ? Number(rawNumeric)
          : undefined;
      const behaviorCode = getCell(behaviorIdx) ? getCell(behaviorIdx).toUpperCase() : undefined;
      const nameEn = getCell(nameEnIdx);
      const labels: Record<string, string> = {};
      if (nameVi) labels.vi = nameVi;
      if (nameEn) labels.en = nameEn;

      const aliases = getCell(aliasesIdx)
        .split(/[|;,]/)
        .map((s) => cleanSpreadsheetCell(s))
        .filter(Boolean);

      const rawSort = getCell(sortOrderIdx);
      const sortOrder =
        rawSort && Number.isInteger(Number(rawSort)) && Number(rawSort) >= 0
          ? Number(rawSort)
          : undefined;

      const rawStatus = getCell(statusIdx).toUpperCase();
      const status =
        rawStatus === '2' || rawStatus.includes('INACTIVE') || rawStatus.includes('KHÓA')
          ? CODE_ITEM_STATUS.INACTIVE
          : CODE_ITEM_STATUS.ACTIVE;

      rows.push({
        typeCode,
        ...(typeName ? { typeName } : {}),
        ...(numericCode !== undefined ? { numericCode } : {}),
        code,
        ...(behaviorCode ? { behaviorCode } : {}),
        name: nameVi || code,
        ...(Object.keys(labels).length > 0 ? { labels } : {}),
        ...(aliases.length > 0 ? { aliases } : {}),
        ...(sortOrder !== undefined ? { sortOrder } : {}),
        status,
      });
    }

    return rows;
  }

  /** Thiết lập cầu nối đa ngôn ngữ 2 tầng (Tier 1: JSONB/Locale File -> Tier 2: DB Custom Override) */
  private configureI18nBridge(): void {
    this.registry.setI18nResolver((typeCode: string, valueCode: string, locale: string) => {
      if (!this.i18nService) return undefined;
      const parts = typeCode.split('.');
      const moduleName = parts[0] ?? 'core';
      const shortType = parts.slice(1).join('.');
      const key = `${moduleName}.codes.${shortType}.${valueCode}`;
      const supportedLocale = locale === 'en' ? 'en' : 'vi';
      const translated = this.i18nService.t(key, {}, supportedLocale);
      return translated && translated !== key ? translated : undefined;
    });
  }

  /** Quét toàn bộ `module.manifest.json` trên đĩa để nạp `codeTypes` vào bộ nhớ L1 */
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
    if (!entity) {
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
    options?: { locale?: string | undefined; includeValues?: boolean | undefined },
  ): CodeTypeSummary {
    const locale = this.resolveEffectiveLocale(options?.locale);
    const values = this.registry.listValues(ct.code, {
      includeInactive: true,
      locale,
    });
    return {
      id: Number(ct.id),
      code: ct.code,
      module: ct.module,
      name: ct.name,
      description: ct.description ?? null,
      isSystem: Boolean(ct.isSystem),
      allowCustomValues: Boolean(ct.allowCustomValues),
      status:
        Number(ct.status) === CODE_ITEM_STATUS.INACTIVE
          ? CODE_ITEM_STATUS.INACTIVE
          : CODE_ITEM_STATUS.ACTIVE,
      totalValues: values.length,
      ...(options?.includeValues ? { values } : {}),
    };
  }

  private formatCodeExportRow(
    stt: number,
    typeCode: string,
    typeName: string,
    val: ResolvedCodeValueView,
  ): Array<string | number> {
    return [
      stt,
      typeCode,
      typeName,
      val.numericCode,
      val.code,
      val.behaviorCode ?? val.code,
      val.labels.vi || val.name,
      val.labels.en || this.registry.getLabel(typeCode, val.numericCode, 'en'),
      val.aliases.join('|'),
      val.sortOrder,
      val.status === CODE_ITEM_STATUS.INACTIVE ? 'Khóa (INACTIVE)' : 'Hoạt động (ACTIVE)',
      val.isSystem ? 'Hệ thống' : 'Tùy chỉnh',
    ];
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
    try {
      const [dbTypes, dbValues] = await Promise.all([
        this.codeTypeRepository.findFiltered({}),
        this.codeValueRepository.findAllOrdered(true),
      ]);
      if (dbTypes.length === 0 && dbValues.length === 0) return;

      const valuesByType = new Map<string, CodeValueEntity[]>();
      for (const v of dbValues) {
        const key = v.typeCode.trim().toLowerCase();
        const list = valuesByType.get(key) ?? [];
        list.push(v);
        valuesByType.set(key, list);
      }

      for (const ct of dbTypes) {
        const key = ct.code.trim().toLowerCase();
        const rows = valuesByType.get(key) ?? [];
        this.registry.replaceTypeValues(
          {
            code: key,
            module: ct.module,
            name: ct.name,
            description: ct.description ?? null,
            isSystem: Boolean(ct.isSystem),
            allowCustomValues: Boolean(ct.allowCustomValues),
            status:
              Number(ct.status) === CODE_ITEM_STATUS.INACTIVE
                ? CODE_ITEM_STATUS.INACTIVE
                : CODE_ITEM_STATUS.ACTIVE,
          },
          rows.map((r) => this.mapEntityToManifestValue(r)),
        );
      }
    } catch {
      // Safe fallback to L1 memory
    }
  }

  private async refreshTypeFromDatabaseSafe(typeCode: string): Promise<void> {
    try {
      const normalized = typeCode.trim().toLowerCase();
      const [ct, rows] = await Promise.all([
        this.codeTypeRepository.findByCode(normalized),
        this.codeValueRepository.findByTypeCode(normalized, true),
      ]);
      if (!ct) return;

      this.registry.replaceTypeValues(
        {
          code: normalized,
          module: ct.module,
          name: ct.name,
          description: ct.description ?? null,
          isSystem: Boolean(ct.isSystem),
          allowCustomValues: Boolean(ct.allowCustomValues),
          status:
            Number(ct.status) === CODE_ITEM_STATUS.INACTIVE
              ? CODE_ITEM_STATUS.INACTIVE
              : CODE_ITEM_STATUS.ACTIVE,
        },
        rows.map((r) => this.mapEntityToManifestValue(r)),
      );
    } catch {
      // Safe fallback to L1 memory
    }
  }

  private syncEntityValueToRegistry(entity: CodeValueEntity): ResolvedCodeValueView {
    const locale = this.resolveEffectiveLocale();
    return this.registry.upsertValue(
      entity.typeCode,
      this.mapEntityToManifestValue(entity),
      locale,
    );
  }

  private mapEntityToManifestValue(entity: CodeValueEntity): CodeValueManifestItem {
    const labels = {
      ...this.parseJsonObject<Record<string, string>>(entity.labelsJson, {}),
    };
    const manifestType = this.manifestCodeTypes.get(entity.typeCode.trim().toLowerCase());
    const manifestVal = manifestType?.values?.find(
      (v) => Number(v.numericCode) === Number(entity.numericCode),
    );
    // Nếu cột `name` trong DB đã được sửa khác với manifest gốc (ví dụ sửa trực tiếp trong DB),
    // ưu tiên lấy `entity.name` làm nhãn hiển thị tiếng Việt (`labels.vi`).
    if (
      entity.name &&
      (!labels.vi ||
        (manifestVal && entity.name !== manifestVal.name && labels.vi === manifestVal.labels?.vi))
    ) {
      labels.vi = entity.name;
    }

    return {
      numericCode: Number(entity.numericCode),
      code: entity.code,
      behaviorCode: entity.behaviorCode ?? null,
      name: entity.name,
      description: entity.description ?? null,
      labels,
      aliases: this.parseJsonArray(entity.aliasesJson),
      color: entity.color ?? null,
      icon: entity.icon ?? null,
      sortOrder: Number(entity.sortOrder ?? entity.numericCode),
      isDefault: Boolean(entity.isDefault),
      isSystem: Boolean(entity.isSystem),
      metadata: this.parseJsonObject<Record<string, unknown> | null>(entity.metadataJson, null),
      status:
        Number(entity.status) === CODE_ITEM_STATUS.INACTIVE
          ? CODE_ITEM_STATUS.INACTIVE
          : CODE_ITEM_STATUS.ACTIVE,
    };
  }

  private resolveEffectiveLocale(requestedLocale?: string): string {
    if (requestedLocale && requestedLocale.trim()) {
      return requestedLocale.trim().toLowerCase();
    }
    return this.i18nService?.getCurrentLocale() ?? 'vi';
  }

  private parseJsonObject<T>(raw: string | null | undefined, fallback: T): T {
    if (!raw) return fallback;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as T;
      }
      return fallback;
    } catch {
      return fallback;
    }
  }

  private parseJsonArray(raw: string | null | undefined): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((v) => String(v).trim()).filter(Boolean);
      }
      return [];
    } catch {
      return [];
    }
  }
}

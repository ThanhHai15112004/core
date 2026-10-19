import { Inject, Injectable, type OnModuleInit, Optional } from '@nestjs/common';
import {
  CODE_ITEM_STATUS,
  type CodeItemStatusCode,
  CodeRegistryService,
  type CodeTypeManifestItem,
  type CodeValueManifestItem,
  ConflictAppException,
  ForbiddenAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
  type ResolvedCodeValueView,
  defaultCodeRegistry,
  discoverManifestCodeTypes,
} from '@packages/kernel/index.js';
import { CoreI18nService } from '@packages/i18n/index.js';
import { AuditLogService } from '@packages/security/index.js';
import type { CodeTypeSummary, ICodesPublicService, SyncCodesResult } from '../contracts/index.js';
import type { CodeTypeEntity } from '../entities/code-type.entity.js';
import type { CodeValueEntity } from '../entities/code-value.entity.js';
import { CodeTypeRepository } from '../repositories/code-type.repository.js';
import { CodeValueRepository } from '../repositories/code-value.repository.js';
import type {
  BootstrapCodesQuery,
  CreateCodeValueRequest,
  ListCodeTypesQuery,
  ListCodeValuesQuery,
  UpdateCodeValueRequest,
} from '../requests/codes.requests.js';

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
      return dbTypes.map((ct) => {
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
          ...(query.includeValues ? { values } : {}),
        };
      });
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
    await this.ensureCodeTypeExists(normalizedType);

    let entity = await this.codeValueRepository.findByTypeAndNumericCode(
      normalizedType,
      numericCode,
    );
    if (!entity) {
      await this.syncManifests();
      entity = await this.codeValueRepository.findByTypeAndNumericCode(normalizedType, numericCode);
    }
    if (!entity) {
      throw new NotFoundAppException('codes.valueNotFound', {
        typeCode: normalizedType,
        numericCode,
      });
    }

    if (entity.isSystem && dto.status === CODE_ITEM_STATUS.INACTIVE) {
      throw new ForbiddenAppException('codes.cannotDeactivateSystemAnchor', [
        { typeCode: normalizedType, code: entity.code },
      ]);
    }

    const beforeSnapshot = {
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

  /** Xóa mềm giá trị danh mục động (Chặn xóa nếu `isSystem = true`) */
  public async removeCodeValue(
    typeCode: string,
    numericCode: number,
  ): Promise<{ deleted: true; typeCode: string; numericCode: number; code: string }> {
    const normalizedType = typeCode.trim().toLowerCase();
    await this.ensureCodeTypeExists(normalizedType);

    let entity = await this.codeValueRepository.findByTypeAndNumericCode(
      normalizedType,
      numericCode,
    );
    if (!entity) {
      await this.syncManifests();
      entity = await this.codeValueRepository.findByTypeAndNumericCode(normalizedType, numericCode);
    }
    if (!entity) {
      throw new NotFoundAppException('codes.valueNotFound', {
        typeCode: normalizedType,
        numericCode,
      });
    }

    if (entity.isSystem) {
      throw new ForbiddenAppException('codes.cannotDeleteSystemValue', [
        { typeCode: normalizedType, numericCode, code: entity.code },
      ]);
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

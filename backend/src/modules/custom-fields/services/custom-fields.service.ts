import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { createPaginatedResult } from '@packages/http/index.js';
import {
  CustomFieldRegistryService,
  NotFoundAppException,
  defaultCustomFieldRegistry,
  defaultSettingRegistry,
  resolvePagination,
  SettingRegistryService,
  type CustomFieldActorContext,
  type CustomFieldDefinitionRecord,
  type CustomFieldFilterCondition,
  type CustomFieldHistoryRecord,
  type CustomFieldOptionItem,
  type CustomFieldValueRecord,
  type PaginatedResult,
  type RegisteredExtensibleEntity,
} from '@packages/kernel/index.js';
import {
  AuditLogService,
  defaultFieldEncryptionService,
  FieldEncryptionService,
} from '@packages/security/index.js';
import type { ICustomFieldsPublicService } from '../contracts/index.js';
import {
  mapDefinitionEntityToRecord,
  mapDefinitionRecordToEntityPayload,
  mapHistoryEntityToRecord,
  mapValueEntityToRecord,
  mapValueRecordToEntityPayload,
} from '../helpers/custom-field-persistence.helper.js';
import { CustomFieldDefinitionRepository } from '../repositories/custom-field-definition.repository.js';
import { CustomFieldHistoryRepository } from '../repositories/custom-field-history.repository.js';
import { CustomFieldOptionRepository } from '../repositories/custom-field-option.repository.js';
import { CustomFieldValueRepository } from '../repositories/custom-field-value.repository.js';
import type {
  CreateCustomFieldDefinitionRequest,
  FilterRecordsByCustomFieldsRequest,
  ListCustomFieldDefinitionsQuery,
  ListCustomFieldHistoriesQuery,
  UpdateCustomFieldDefinitionRequest,
} from '../requests/custom-fields.requests.js';
import {
  CustomFieldResponseMapper,
  type CustomFieldDefinitionResponse,
  type CustomFieldHistoryResponse,
  type CustomFieldRecordValuesResponse,
  type ExtensibleEntityResponse,
} from '../responses/custom-fields.response.js';

@Injectable()
export class CustomFieldsService implements ICustomFieldsPublicService, OnModuleInit {
  private readonly registry: CustomFieldRegistryService;
  private readonly settingRegistry: SettingRegistryService;
  private readonly encryptionService: FieldEncryptionService;

  constructor(
    @Optional() registry?: CustomFieldRegistryService,
    @Optional() settingRegistry?: SettingRegistryService,
    @Optional() encryptionService?: FieldEncryptionService,
    @Optional() private readonly definitionRepo?: CustomFieldDefinitionRepository,
    @Optional() private readonly optionRepo?: CustomFieldOptionRepository,
    @Optional() private readonly valueRepo?: CustomFieldValueRepository,
    @Optional() private readonly historyRepo?: CustomFieldHistoryRepository,
    @Optional() private readonly auditLogService?: AuditLogService,
  ) {
    this.registry = registry ?? defaultCustomFieldRegistry;
    this.settingRegistry = settingRegistry ?? defaultSettingRegistry;
    this.encryptionService = encryptionService ?? defaultFieldEncryptionService;
  }

  public async onModuleInit(): Promise<void> {
    await this.syncFromDatabaseToRegistry();
  }

  public async syncFromDatabaseToRegistry(): Promise<void> {
    this.registry.syncFromManifests();
    if (!this.definitionRepo) return;

    const [dbDefs, dbOptions, dbValues, dbHistories] = await Promise.all([
      this.definitionRepo.findAllOrdered(),
      this.optionRepo ? this.optionRepo.findAllOrdered() : Promise.resolve([]),
      this.valueRepo ? this.valueRepo.findAllValues() : Promise.resolve([]),
      this.historyRepo ? this.historyRepo.findAllOrdered(500) : Promise.resolve([]),
    ]);

    if (dbDefs.length > 0) {
      const optionsByFieldId = new Map<string, typeof dbOptions>();
      for (const opt of dbOptions) {
        const list = optionsByFieldId.get(String(opt.fieldId)) ?? [];
        list.push(opt);
        optionsByFieldId.set(String(opt.fieldId), list);
      }

      for (const def of dbDefs) {
        const record = mapDefinitionEntityToRecord(
          def,
          optionsByFieldId.get(String(def.id)) ?? [],
        );
        this.registry.hydrateFieldDefinition(record);
      }
    }

    if (dbValues.length > 0) {
      for (const val of dbValues) {
        const valueRecord = mapValueEntityToRecord(val, this.encryptionService);
        this.registry.hydrateFieldValue(valueRecord);
      }
    }

    if (dbHistories.length > 0) {
      for (const hist of dbHistories) {
        const histRecord = mapHistoryEntityToRecord(hist);
        this.registry.recordHistory({
          fieldId: histRecord.fieldId,
          entityCode: histRecord.entityCode,
          fieldKey: histRecord.fieldKey,
          actionType: histRecord.actionType,
          changedFields: histRecord.changedFields,
          beforeSnapshot: histRecord.beforeSnapshot,
          afterSnapshot: histRecord.afterSnapshot,
          reason: histRecord.reason,
          actorUserId: histRecord.actorUserId,
        });
      }
    }
  }

  /** 9.8.1: Danh sách loại đối tượng được đăng ký mở rộng kèm thống kê trường */
  public getRegisteredEntities(): RegisteredExtensibleEntity[] {
    return this.registry.listExtensibleEntities();
  }

  public listRegisteredEntitiesWithSummary(): ExtensibleEntityResponse[] {
    const entities = this.registry.listExtensibleEntities();
    const allDefinitions = this.registry.listFieldDefinitions();
    return entities.map((e) => CustomFieldResponseMapper.toEntityResponse(e, allDefinitions));
  }

  /** 9.8.2: Truy vấn danh sách cấu hình trường tùy chỉnh */
  public async listDefinitionsByEntity(
    entityCode: string,
    includeInactive = false,
  ): Promise<CustomFieldDefinitionRecord[]> {
    return this.registry.listFieldDefinitions({
      entityCode,
      ...(includeInactive ? {} : { status: 1 }),
    });
  }

  public async listDefinitionsPaginated(
    query: ListCustomFieldDefinitionsQuery,
  ): Promise<PaginatedResult<CustomFieldDefinitionResponse>> {
    const { page, limit, skip } = resolvePagination(query);
    let items = this.registry.listFieldDefinitions({
      entityCode: query.entityCode,
      module: query.module,
      dataType: query.dataType,
      isIndexed: query.isIndexed,
      status: query.status ?? (query.includeInactive === false ? 1 : undefined),
    });

    if (query.isSensitive !== undefined) {
      items = items.filter((d) => d.isSensitive === query.isSensitive);
    }
    if (query.showInApi !== undefined) {
      items = items.filter((d) => d.showInApi === query.showInApi);
    }
    if (query.search?.trim()) {
      const kw = query.search.trim().toLowerCase();
      items = items.filter(
        (d) =>
          d.fieldKey.toLowerCase().includes(kw) ||
          d.name.toLowerCase().includes(kw) ||
          (d.description ?? '').toLowerCase().includes(kw) ||
          d.entityCode.toLowerCase().includes(kw),
      );
    }

    const total = items.length;
    const paged = items
      .slice(skip, skip + limit)
      .map(CustomFieldResponseMapper.toDefinitionResponse);
    return createPaginatedResult(paged, total, page, limit);
  }

  public async getDefinitionById(id: number | string): Promise<CustomFieldDefinitionResponse> {
    const record = this.registry.getFieldDefinitionById(Number(id));
    if (!record) {
      throw new NotFoundAppException('customFields.definitionNotFound', { id });
    }
    return CustomFieldResponseMapper.toDefinitionResponse(record);
  }

  /** 9.8.2, 9.8.3, 9.8.4, 9.8.5, 9.8.6, 9.8.7, 9.8.8: Tạo mới trường tùy chỉnh */
  public async createDefinition(
    payload: CreateCustomFieldDefinitionRequest,
    actorUserId?: number | null,
  ): Promise<CustomFieldDefinitionResponse> {
    const { definition, history } = this.registry.createFieldDefinition(payload, actorUserId);
    await this.persistDefinitionAndOptions(definition);
    await this.persistHistoryRecord(history);

    await this.auditLogService?.record({
      actorUserId: actorUserId ?? null,
      module: 'custom-fields',
      feature: 'definition',
      action: 'custom-fields.definition.create',
      resourceType: 'custom_field_definition',
      resourceId: definition.id,
      beforeData: null,
      afterData: {
        entityCode: definition.entityCode,
        fieldKey: definition.fieldKey,
        dataType: definition.dataType,
        isIndexed: definition.isIndexed,
        isSensitive: definition.isSensitive,
      },
      reason: payload.reason ?? 'Created custom field definition',
    });

    return CustomFieldResponseMapper.toDefinitionResponse(definition);
  }

  /** 9.8.3, 9.8.4, 9.8.6, 9.8.7, 9.8.8: Cập nhật cấu hình trường (Chặn đổi dataType tùy tiện) */
  public async updateDefinition(
    id: number | string,
    payload: UpdateCustomFieldDefinitionRequest,
    actorUserId?: number | null,
  ): Promise<CustomFieldDefinitionResponse> {
    const numericId = Number(id);
    try {
      const { definition, history } = this.registry.updateFieldDefinition(
        numericId,
        payload,
        actorUserId,
      );
      await this.persistDefinitionAndOptions(definition);
      await this.persistHistoryRecord(history);

      await this.auditLogService?.record({
        actorUserId: actorUserId ?? null,
        module: 'custom-fields',
        feature: 'definition',
        action: 'custom-fields.definition.update',
        resourceType: 'custom_field_definition',
        resourceId: definition.id,
        beforeData: history.beforeSnapshot,
        afterData: history.afterSnapshot,
        reason: payload.reason ?? 'Updated custom field definition',
      });

      return CustomFieldResponseMapper.toDefinitionResponse(definition);
    } catch (error) {
      const latestBlocked = this.registry.listFieldHistories({ fieldId: numericId, limit: 1 })[0];
      if (latestBlocked && latestBlocked.actionType === 'DATA_TYPE_CHANGE_BLOCKED') {
        await this.persistHistoryRecord(latestBlocked);
      }
      throw error;
    }
  }

  /** 9.8.5: Cập nhật danh sách lựa chọn có thứ tự (sortOrder) và trạng thái (status) */
  public async updateFieldOptions(
    definitionId: number | string,
    options: readonly CustomFieldOptionItem[],
    actorUserId?: number | null,
    reason?: string | null,
  ): Promise<CustomFieldDefinitionRecord> {
    const { definition, history } = this.registry.setFieldOptions(
      Number(definitionId),
      options,
      actorUserId,
      reason,
    );
    await this.persistDefinitionAndOptions(definition);
    await this.persistHistoryRecord(history);
    return definition;
  }

  /** 9.8.3 & 9.8.4: Kiểm tra bắt buộc, validation, quyền sửa từng trường và lưu giá trị */
  public async validateAndSaveRecordValues(params: {
    entityCode: string;
    recordId: string | number;
    values: Record<string, unknown>;
    mode?: 'create' | 'update';
    actor?: CustomFieldActorContext;
  }): Promise<CustomFieldValueRecord[]> {
    const saved = this.registry.setRecordCustomFields({
      entityCode: params.entityCode,
      recordId: params.recordId,
      values: params.values,
      mode: params.mode ?? 'update',
      actor: params.actor,
    });

    if (this.valueRepo) {
      for (const item of saved) {
        const def = this.registry.getFieldDefinition(item.entityCode, item.fieldKey);
        const payload = mapValueRecordToEntityPayload(
          item,
          def?.isIndexed ?? false,
          this.encryptionService,
        );
        await this.valueRepo.upsertValue(payload);
      }
    }

    return saved;
  }

  /** 9.8.4 & 9.8.6: Lấy giá trị trường tùy chỉnh hiển thị trong API theo cấu hình & quyền xem */
  public async getRecordValuesForApi(
    entityCode: string,
    recordId: string | number,
    options?: {
      viewMode?: 'list' | 'detail';
      actor?: CustomFieldActorContext;
    },
  ): Promise<Record<string, unknown>> {
    return this.registry.resolveRecordCustomFieldsForApi({
      entityCode,
      recordId,
      viewMode: options?.viewMode ?? 'detail',
      actor: options?.actor,
    });
  }

  public async getBatchRecordValuesForApi(
    entityCode: string,
    recordIds: readonly (string | number)[],
    options?: {
      viewMode?: 'list' | 'detail';
      actor?: CustomFieldActorContext;
    },
  ): Promise<Map<string, Record<string, unknown>>> {
    return this.registry.resolveBatchRecordsCustomFieldsForApi({
      entityCode,
      recordIds,
      viewMode: options?.viewMode ?? 'list',
      actor: options?.actor,
    });
  }

  public async getRecordValuesResponse(
    entityCode: string,
    recordId: string | number,
    actor?: CustomFieldActorContext,
  ): Promise<CustomFieldRecordValuesResponse> {
    const values = this.registry.resolveRecordCustomFieldsForApi({
      entityCode,
      recordId,
      viewMode: 'detail',
      actor,
    });
    return {
      entityCode: entityCode.trim().toLowerCase(),
      recordId: String(recordId).trim(),
      values,
    };
  }

  /** 9.8.7: Lọc danh sách recordId theo trường tùy chỉnh (Chỉ cho phép trường có isIndexed = true) */
  public async filterRecordIdsByCustomFields(params: {
    entityCode: string;
    filters: readonly CustomFieldFilterCondition[];
    actor?: CustomFieldActorContext;
  }): Promise<string[]> {
    return this.registry.filterRecordIdsByCustomFields(params);
  }

  public async filterRecordsEndpoint(
    payload: FilterRecordsByCustomFieldsRequest,
    actor?: CustomFieldActorContext,
  ): Promise<{
    entityCode: string;
    matchedRecordIds: string[];
    totalMatched: number;
    appliedFilters: readonly CustomFieldFilterCondition[];
  }> {
    const matchedRecordIds = this.registry.filterRecordIdsByCustomFields({
      entityCode: payload.entityCode,
      filters: payload.filters,
      actor,
    });
    return {
      entityCode: payload.entityCode.trim().toLowerCase(),
      matchedRecordIds,
      totalMatched: matchedRecordIds.length,
      appliedFilters: payload.filters,
    };
  }

  /** 9.8.8: Truy vấn lịch sử thay đổi cấu hình trường tùy chỉnh */
  public async listHistories(params?: {
    fieldId?: number;
    entityCode?: string;
    fieldKey?: string;
    limit?: number;
  }): Promise<CustomFieldHistoryRecord[]> {
    return this.registry.listFieldHistories(params);
  }

  public async listHistoriesPaginated(
    query: ListCustomFieldHistoriesQuery,
  ): Promise<PaginatedResult<CustomFieldHistoryResponse>> {
    const { page, limit, skip } = resolvePagination(query);
    let items = this.registry.listFieldHistories({
      fieldId: query.fieldId,
      entityCode: query.entityCode,
      fieldKey: query.fieldKey,
      limit: 200,
    });
    if (query.actionType?.trim()) {
      const ct = query.actionType.trim().toUpperCase();
      items = items.filter((h) => h.actionType.toUpperCase() === ct);
    }
    const total = items.length;
    const paged = items
      .slice(skip, skip + limit)
      .map(CustomFieldResponseMapper.toHistoryResponse);
    return createPaginatedResult(paged, total, page, limit);
  }

  private async persistDefinitionAndOptions(record: CustomFieldDefinitionRecord): Promise<void> {
    if (!this.definitionRepo) return;
    const savedDef = await this.definitionRepo.upsertDefinition(
      mapDefinitionRecordToEntityPayload(record),
    );
    if (savedDef && this.optionRepo && record.options.length > 0) {
      await this.optionRepo.replaceOptionsForField(
        String(savedDef.id),
        record.options.map((opt) => ({
          optionCode: opt.optionCode,
          optionLabel: opt.label,
          labelsJson: opt.labels ? JSON.stringify(opt.labels) : null,
          color: opt.color ?? null,
          sortOrder: opt.sortOrder,
          isDefault: Boolean(opt.isDefault),
          status: opt.status,
        })),
      );
    }
  }

  private async persistHistoryRecord(history: CustomFieldHistoryRecord): Promise<void> {
    if (!this.historyRepo) return;
    await this.historyRepo.recordHistory({
      fieldId: String(history.fieldId),
      entityCode: history.entityCode,
      fieldKey: history.fieldKey,
      actionType: history.actionType,
      changedFieldsJson: JSON.stringify(history.changedFields),
      beforeSnapshotJson: history.beforeSnapshot ? JSON.stringify(history.beforeSnapshot) : null,
      afterSnapshotJson: history.afterSnapshot ? JSON.stringify(history.afterSnapshot) : null,
      reason: history.reason,
      actorUserId: history.actorUserId !== null ? String(history.actorUserId) : null,
    });
  }
}

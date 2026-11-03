import { Injectable } from '@nestjs/common';
import {
  CUSTOM_FIELD_DATA_TYPE,
  CUSTOM_FIELD_STATUS,
  type CustomFieldActorContext,
  type CustomFieldDataType,
  type CustomFieldDefinitionRecord,
  type CustomFieldFilterCondition,
  type CustomFieldHistoryActionType,
  type CustomFieldHistoryRecord,
  type CustomFieldManifestItem,
  type CustomFieldOptionItem,
  type CustomFieldStatusCode,
  type CustomFieldValidationRules,
  type CustomFieldValueRecord,
  type ExtensibleEntityManifestItem,
  type RegisteredExtensibleEntity,
  discoverManifestCustomFields,
  discoverManifestExtensibleEntities,
} from '../contracts/custom-field.contract.js';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
} from '../errors/http-exceptions.js';
import { NotFoundAppException } from '../errors/not-found.exception.js';
import { defaultCodeRegistry } from './code-registry.service.js';

export interface CreateCustomFieldInput {
  readonly entityCode: string;
  readonly module?: string | undefined;
  readonly fieldKey: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly dataType: CustomFieldDataType;
  readonly defaultValue?: unknown;
  readonly validationRules?: CustomFieldValidationRules | null | undefined;
  readonly options?: readonly CustomFieldOptionItem[] | undefined;
  readonly codeTypeCode?: string | null | undefined;
  readonly isRequired?: boolean | undefined;
  readonly isIndexed?: boolean | undefined;
  readonly showInApi?: boolean | undefined;
  readonly showInList?: boolean | undefined;
  readonly showInDetail?: boolean | undefined;
  readonly isSensitive?: boolean | undefined;
  readonly viewPermission?: string | null | undefined;
  readonly editPermission?: string | null | undefined;
  readonly allowedViewRoles?: readonly string[] | undefined;
  readonly allowedEditRoles?: readonly string[] | undefined;
  readonly sortOrder?: number | undefined;
  readonly isSystem?: boolean | undefined;
  readonly status?: CustomFieldStatusCode | undefined;
  readonly reason?: string | null | undefined;
}

export interface UpdateCustomFieldInput {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly dataType?: CustomFieldDataType | undefined;
  readonly defaultValue?: unknown;
  readonly validationRules?: CustomFieldValidationRules | null | undefined;
  readonly options?: readonly CustomFieldOptionItem[] | undefined;
  readonly codeTypeCode?: string | null | undefined;
  readonly isRequired?: boolean | undefined;
  readonly isIndexed?: boolean | undefined;
  readonly showInApi?: boolean | undefined;
  readonly showInList?: boolean | undefined;
  readonly showInDetail?: boolean | undefined;
  readonly isSensitive?: boolean | undefined;
  readonly viewPermission?: string | null | undefined;
  readonly editPermission?: string | null | undefined;
  readonly allowedViewRoles?: readonly string[] | undefined;
  readonly allowedEditRoles?: readonly string[] | undefined;
  readonly sortOrder?: number | undefined;
  readonly status?: CustomFieldStatusCode | undefined;
  readonly reason?: string | null | undefined;
}

const VALID_DATA_TYPES = new Set<CustomFieldDataType>([
  CUSTOM_FIELD_DATA_TYPE.TEXT,
  CUSTOM_FIELD_DATA_TYPE.NUMBER,
  CUSTOM_FIELD_DATA_TYPE.DATE,
  CUSTOM_FIELD_DATA_TYPE.BOOLEAN,
  CUSTOM_FIELD_DATA_TYPE.SELECT,
]);

function normalizeEntityCode(code: string): string {
  return code.trim().toLowerCase();
}

function normalizeFieldKey(key: string): string {
  return key.trim();
}

function makeDefinitionKey(entityCode: string, fieldKey: string): string {
  return `${normalizeEntityCode(entityCode)}::${normalizeFieldKey(fieldKey).toLowerCase()}`;
}

function makeValueKey(entityCode: string, recordId: string | number, fieldKey: string): string {
  return `${normalizeEntityCode(entityCode)}::${String(recordId).trim()}::${normalizeFieldKey(fieldKey).toLowerCase()}`;
}

function normalizeOptions(
  options?: readonly CustomFieldOptionItem[] | null,
): CustomFieldOptionItem[] {
  if (!Array.isArray(options) || options.length === 0) return [];
  const seen = new Set<string>();
  const normalized: CustomFieldOptionItem[] = [];

  for (let i = 0; i < options.length; i++) {
    const item = options[i];
    if (!item || typeof item.optionCode !== 'string' || !item.optionCode.trim()) continue;
    const code = item.optionCode.trim();
    const upperKey = code.toUpperCase();
    if (seen.has(upperKey)) continue;
    seen.add(upperKey);
    normalized.push({
      optionCode: code,
      label: (item.label ?? code).trim(),
      ...(item.labels ? { labels: item.labels } : {}),
      color: item.color ?? null,
      sortOrder: typeof item.sortOrder === 'number' ? Math.trunc(item.sortOrder) : i + 1,
      isDefault: Boolean(item.isDefault),
      status:
        Number(item.status) === CUSTOM_FIELD_STATUS.INACTIVE
          ? CUSTOM_FIELD_STATUS.INACTIVE
          : CUSTOM_FIELD_STATUS.ACTIVE,
    });
  }

  return normalized.sort(
    (a, b) => a.sortOrder - b.sortOrder || a.optionCode.localeCompare(b.optionCode),
  );
}

@Injectable()
export class CustomFieldRegistryService {
  private readonly extensibleEntities = new Map<string, RegisteredExtensibleEntity>();
  private readonly definitionsByKey = new Map<string, CustomFieldDefinitionRecord>();
  private readonly definitionsById = new Map<number, CustomFieldDefinitionRecord>();
  private readonly valuesByKey = new Map<string, CustomFieldValueRecord>();
  private readonly histories: CustomFieldHistoryRecord[] = [];

  private nextFieldId = 1;
  private nextValueId = 1;
  private nextHistoryId = 1;
  private manifestSynced = false;

  /**
   * 9.8.1 & 9.8.2 — Đồng bộ tự động danh sách `extensibleEntities` và `customFields` từ `module.manifest.json`.
   */
  public syncFromManifests(): {
    readonly registeredEntities: number;
    readonly registeredFields: number;
  } {
    let registeredEntities = 0;
    let registeredFields = 0;

    for (const item of discoverManifestExtensibleEntities()) {
      this.registerExtensibleEntity(item);
      registeredEntities++;
    }

    for (const field of discoverManifestCustomFields()) {
      const defKey = makeDefinitionKey(field.entityCode, field.fieldKey);
      if (!this.definitionsByKey.has(defKey)) {
        this.registerManifestCustomField(field);
        registeredFields++;
      }
    }

    this.manifestSynced = true;
    return { registeredEntities, registeredFields };
  }

  private ensureSynced(): void {
    if (!this.manifestSynced) {
      this.syncFromManifests();
    }
  }

  /**
   * 9.8.1 — Đăng ký loại đối tượng được phép mở rộng (từ `module.manifest.json` hoặc runtime).
   */
  public registerExtensibleEntity(item: ExtensibleEntityManifestItem): RegisteredExtensibleEntity {
    const code = normalizeEntityCode(item.code);
    const moduleName = (item.module ?? code.split('.')[0] ?? 'core').trim().toLowerCase();
    const record: RegisteredExtensibleEntity = {
      code,
      module: moduleName,
      entityType: item.entityType.trim(),
      name: item.name.trim(),
      description: item.description?.trim() ?? null,
      primaryKeyField: item.primaryKeyField?.trim() || 'id',
      readPermission: item.readPermission?.trim() || `${moduleName}.read`,
      writePermission: item.writePermission?.trim() || `${moduleName}.update`,
      maxCustomFields: Math.max(1, Math.trunc(item.maxCustomFields ?? 50)),
      allowDynamicFields: item.allowDynamicFields !== false,
      isSystem: item.isSystem ?? true,
      status:
        Number(item.status) === CUSTOM_FIELD_STATUS.INACTIVE
          ? CUSTOM_FIELD_STATUS.INACTIVE
          : CUSTOM_FIELD_STATUS.ACTIVE,
      registeredAt: new Date().toISOString(),
    };
    this.extensibleEntities.set(code, record);
    return record;
  }

  /**
   * 9.8.1 — Lấy danh sách các loại đối tượng được phép mở rộng.
   */
  public listExtensibleEntities(filter?: {
    readonly module?: string | undefined;
    readonly status?: number | undefined;
  }): RegisteredExtensibleEntity[] {
    this.ensureSynced();
    const targetMod = filter?.module?.trim().toLowerCase();
    return [...this.extensibleEntities.values()]
      .filter((e) => {
        if (targetMod && e.module !== targetMod) return false;
        if (filter?.status !== undefined && e.status !== Number(filter.status)) return false;
        return true;
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  public getExtensibleEntity(entityCode: string): RegisteredExtensibleEntity | null {
    this.ensureSynced();
    return this.extensibleEntities.get(normalizeEntityCode(entityCode)) ?? null;
  }

  /**
   * 9.8.1 — Kiểm tra loại đối tượng có được module cho phép mở rộng Custom Field hay không.
   */
  public ensureExtensibleEntityAllowed(entityCode: string): RegisteredExtensibleEntity {
    this.ensureSynced();
    const code = normalizeEntityCode(entityCode);
    const entity = this.extensibleEntities.get(code);
    if (!entity) {
      throw new ForbiddenAppException('customFields.entityNotExtensible', [
        {
          entityCode: code,
          reason: 'Entity type is not registered in extensibleEntities of any enabled module',
        },
      ]);
    }
    if (!entity.allowDynamicFields || entity.status !== CUSTOM_FIELD_STATUS.ACTIVE) {
      throw new ForbiddenAppException('customFields.entityExtensionDisabled', [
        {
          entityCode: code,
          allowDynamicFields: entity.allowDynamicFields,
          status: entity.status,
        },
      ]);
    }
    return entity;
  }

  private registerManifestCustomField(item: CustomFieldManifestItem): CustomFieldDefinitionRecord {
    const code = normalizeEntityCode(item.entityCode);
    const entity = this.extensibleEntities.get(code);
    const nowIso = new Date().toISOString();
    const id = this.nextFieldId++;
    const record: CustomFieldDefinitionRecord = {
      id,
      entityCode: code,
      module: (item.module ?? entity?.module ?? code.split('.')[0] ?? 'core').trim().toLowerCase(),
      fieldKey: normalizeFieldKey(item.fieldKey),
      name: item.name.trim(),
      description: item.description?.trim() ?? null,
      dataType: item.dataType,
      defaultValue: item.defaultValue ?? null,
      validationRules: item.validationRules ?? null,
      options: normalizeOptions(item.options),
      codeTypeCode: item.codeTypeCode?.trim() ?? null,
      isRequired: Boolean(item.isRequired),
      isIndexed: Boolean(item.isIndexed),
      showInApi: item.showInApi !== false,
      showInList: item.showInList !== false,
      showInDetail: item.showInDetail !== false,
      isSensitive: Boolean(item.isSensitive),
      viewPermission: item.viewPermission?.trim() ?? null,
      editPermission: item.editPermission?.trim() ?? null,
      allowedViewRoles: [...(item.allowedViewRoles ?? [])],
      allowedEditRoles: [...(item.allowedEditRoles ?? [])],
      sortOrder: typeof item.sortOrder === 'number' ? Math.trunc(item.sortOrder) : id,
      isSystem: item.isSystem ?? true,
      status: item.status ?? CUSTOM_FIELD_STATUS.ACTIVE,
      version: 1,
      createdBy: null,
      updatedBy: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    this.definitionsByKey.set(makeDefinitionKey(record.entityCode, record.fieldKey), record);
    this.definitionsById.set(record.id, record);
    return record;
  }

  /**
   * Đồng bộ định nghĩa trường tùy chỉnh từ DB lên bộ nhớ.
   */
  public hydrateFieldDefinition(record: CustomFieldDefinitionRecord): CustomFieldDefinitionRecord {
    const normalized: CustomFieldDefinitionRecord = {
      ...record,
      entityCode: normalizeEntityCode(record.entityCode),
      fieldKey: normalizeFieldKey(record.fieldKey),
      options: normalizeOptions(record.options),
    };
    this.definitionsByKey.set(
      makeDefinitionKey(normalized.entityCode, normalized.fieldKey),
      normalized,
    );
    this.definitionsById.set(Number(normalized.id), normalized);
    if (Number(normalized.id) >= this.nextFieldId) {
      this.nextFieldId = Number(normalized.id) + 1;
    }
    return normalized;
  }

  /**
   * Đồng bộ bản ghi giá trị trường tùy chỉnh từ DB lên bộ nhớ.
   */
  public hydrateFieldValue(record: CustomFieldValueRecord): CustomFieldValueRecord {
    const key = makeValueKey(record.entityCode, record.recordId, record.fieldKey);
    this.valuesByKey.set(key, record);
    if (Number(record.id) >= this.nextValueId) {
      this.nextValueId = Number(record.id) + 1;
    }
    return record;
  }

  /**
   * 9.8.2 — Tạo mới trường tùy chỉnh (Text, Number, Date, Boolean, Select).
   */
  public createFieldDefinition(
    input: CreateCustomFieldInput,
    actorId?: number | null,
  ): {
    readonly definition: CustomFieldDefinitionRecord;
    readonly history: CustomFieldHistoryRecord;
  } {
    const entity = this.ensureExtensibleEntityAllowed(input.entityCode);
    const fieldKey = normalizeFieldKey(input.fieldKey);
    if (!/^[a-zA-Z][a-zA-Z0-9_]{1,63}$/.test(fieldKey)) {
      throw new BadRequestAppException('customFields.invalidFieldKey', [
        {
          fieldKey,
          message: 'fieldKey must start with a letter and contain only letters, digits, or _',
        },
      ]);
    }

    if (!VALID_DATA_TYPES.has(input.dataType)) {
      throw new BadRequestAppException('customFields.invalidDataType', [
        { dataType: input.dataType },
      ]);
    }

    const defKey = makeDefinitionKey(entity.code, fieldKey);
    if (this.definitionsByKey.has(defKey)) {
      throw new ConflictAppException('customFields.duplicateFieldKey', [
        { entityCode: entity.code, fieldKey },
      ]);
    }

    const existingCount = this.listFieldDefinitions({ entityCode: entity.code }).length;
    if (existingCount >= entity.maxCustomFields) {
      throw new BadRequestAppException('customFields.maxFieldsExceeded', [
        { entityCode: entity.code, maxCustomFields: entity.maxCustomFields },
      ]);
    }

    const options = normalizeOptions(input.options);
    if (
      input.dataType === CUSTOM_FIELD_DATA_TYPE.SELECT &&
      options.length === 0 &&
      !input.codeTypeCode
    ) {
      throw new BadRequestAppException('customFields.selectOptionsRequired', [
        { fieldKey, message: 'SELECT field requires non-empty options or codeTypeCode' },
      ]);
    }

    const nowIso = new Date().toISOString();
    const id = this.nextFieldId++;
    const definition: CustomFieldDefinitionRecord = {
      id,
      entityCode: entity.code,
      module: (input.module ?? entity.module).trim().toLowerCase(),
      fieldKey,
      name: input.name.trim(),
      description: input.description?.trim() ?? null,
      dataType: input.dataType,
      defaultValue: input.defaultValue ?? null,
      validationRules: input.validationRules ?? null,
      options,
      codeTypeCode: input.codeTypeCode?.trim() ?? null,
      isRequired: Boolean(input.isRequired),
      isIndexed: Boolean(input.isIndexed),
      showInApi: input.showInApi !== false,
      showInList: input.showInList !== false,
      showInDetail: input.showInDetail !== false,
      isSensitive: Boolean(input.isSensitive),
      viewPermission: input.viewPermission?.trim() ?? null,
      editPermission: input.editPermission?.trim() ?? null,
      allowedViewRoles: [...(input.allowedViewRoles ?? [])],
      allowedEditRoles: [...(input.allowedEditRoles ?? [])],
      sortOrder:
        typeof input.sortOrder === 'number' ? Math.trunc(input.sortOrder) : existingCount + 1,
      isSystem: Boolean(input.isSystem),
      status: input.status ?? CUSTOM_FIELD_STATUS.ACTIVE,
      version: 1,
      createdBy: actorId ?? null,
      updatedBy: actorId ?? null,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (definition.defaultValue !== null && definition.defaultValue !== undefined) {
      this.validateSingleFieldValueOrThrow(definition, definition.defaultValue, false);
    }

    this.definitionsByKey.set(defKey, definition);
    this.definitionsById.set(definition.id, definition);

    const history = this.recordHistory({
      fieldId: definition.id,
      entityCode: definition.entityCode,
      fieldKey: definition.fieldKey,
      actionType: 'CREATED',
      changedFields: ['*'],
      beforeSnapshot: null,
      afterSnapshot: this.toSnapshot(definition),
      reason: input.reason ?? 'Created custom field definition',
      actorUserId: actorId ?? null,
    });

    return { definition, history };
  }

  /**
   * 9.8.2, 9.8.3, 9.8.4, 9.8.5, 9.8.6, 9.8.7 & 9.8.8 — Cập nhật cấu hình trường tùy chỉnh.
   * Nghiêm cấm đổi `dataType` tùy tiện (9.8.8) và ghi lịch sử đầy đủ.
   */
  public updateFieldDefinition(
    idOrEntityField: number | { readonly entityCode: string; readonly fieldKey: string },
    input: UpdateCustomFieldInput,
    actorId?: number | null,
  ): {
    readonly definition: CustomFieldDefinitionRecord;
    readonly history: CustomFieldHistoryRecord;
  } {
    this.ensureSynced();
    const existing =
      typeof idOrEntityField === 'number'
        ? this.definitionsById.get(idOrEntityField)
        : this.definitionsByKey.get(
            makeDefinitionKey(idOrEntityField.entityCode, idOrEntityField.fieldKey),
          );

    if (!existing) {
      throw new NotFoundAppException('customFields.definitionNotFound', {
        target:
          typeof idOrEntityField === 'number'
            ? idOrEntityField
            : `${idOrEntityField.entityCode}.${idOrEntityField.fieldKey}`,
      });
    }

    const beforeSnapshot = this.toSnapshot(existing);

    // 9.8.8 — Chặn đổi kiểu dữ liệu tùy tiện!
    if (input.dataType !== undefined && input.dataType !== existing.dataType) {
      this.recordHistory({
        fieldId: existing.id,
        entityCode: existing.entityCode,
        fieldKey: existing.fieldKey,
        actionType: 'DATA_TYPE_CHANGE_BLOCKED',
        changedFields: ['dataType'],
        beforeSnapshot,
        afterSnapshot: { attemptedDataType: input.dataType },
        reason: input.reason ?? `Blocked arbitrary dataType change from ${existing.dataType} to ${input.dataType}`,
        actorUserId: actorId ?? null,
      });
      throw new ConflictAppException('customFields.dataTypeChangeForbidden', [
        {
          fieldId: existing.id,
          entityCode: existing.entityCode,
          fieldKey: existing.fieldKey,
          currentDataType: existing.dataType,
          attemptedDataType: input.dataType,
        },
      ]);
    }

    const nextOptions =
      input.options !== undefined ? normalizeOptions(input.options) : existing.options;
    const nextCodeTypeCode =
      input.codeTypeCode !== undefined ? (input.codeTypeCode?.trim() ?? null) : existing.codeTypeCode;

    if (
      existing.dataType === CUSTOM_FIELD_DATA_TYPE.SELECT &&
      nextOptions.length === 0 &&
      !nextCodeTypeCode
    ) {
      throw new BadRequestAppException('customFields.selectOptionsRequired', [
        { fieldKey: existing.fieldKey },
      ]);
    }

    const updated: CustomFieldDefinitionRecord = {
      ...existing,
      name: input.name !== undefined ? input.name.trim() : existing.name,
      description:
        input.description !== undefined ? (input.description?.trim() ?? null) : existing.description,
      defaultValue:
        input.defaultValue !== undefined ? input.defaultValue : existing.defaultValue,
      validationRules:
        input.validationRules !== undefined ? input.validationRules : existing.validationRules,
      options: nextOptions,
      codeTypeCode: nextCodeTypeCode,
      isRequired: input.isRequired !== undefined ? Boolean(input.isRequired) : existing.isRequired,
      isIndexed: input.isIndexed !== undefined ? Boolean(input.isIndexed) : existing.isIndexed,
      showInApi: input.showInApi !== undefined ? Boolean(input.showInApi) : existing.showInApi,
      showInList: input.showInList !== undefined ? Boolean(input.showInList) : existing.showInList,
      showInDetail:
        input.showInDetail !== undefined ? Boolean(input.showInDetail) : existing.showInDetail,
      isSensitive:
        input.isSensitive !== undefined ? Boolean(input.isSensitive) : existing.isSensitive,
      viewPermission:
        input.viewPermission !== undefined
          ? (input.viewPermission?.trim() ?? null)
          : existing.viewPermission,
      editPermission:
        input.editPermission !== undefined
          ? (input.editPermission?.trim() ?? null)
          : existing.editPermission,
      allowedViewRoles:
        input.allowedViewRoles !== undefined
          ? [...input.allowedViewRoles]
          : existing.allowedViewRoles,
      allowedEditRoles:
        input.allowedEditRoles !== undefined
          ? [...input.allowedEditRoles]
          : existing.allowedEditRoles,
      sortOrder:
        input.sortOrder !== undefined ? Math.trunc(input.sortOrder) : existing.sortOrder,
      status: input.status !== undefined ? input.status : existing.status,
      version: existing.version + 1,
      updatedBy: actorId ?? existing.updatedBy,
      updatedAt: new Date().toISOString(),
    };

    if (updated.defaultValue !== null && updated.defaultValue !== undefined) {
      this.validateSingleFieldValueOrThrow(updated, updated.defaultValue, false);
    }

    const defKey = makeDefinitionKey(updated.entityCode, updated.fieldKey);
    this.definitionsByKey.set(defKey, updated);
    this.definitionsById.set(updated.id, updated);

    const afterSnapshot = this.toSnapshot(updated);
    const changedFields = Object.keys(afterSnapshot).filter(
      (k) => JSON.stringify(beforeSnapshot[k]) !== JSON.stringify(afterSnapshot[k]),
    );

    const actionType: CustomFieldHistoryActionType =
      input.options !== undefined
        ? 'OPTIONS_UPDATED'
        : input.status !== undefined && input.status !== existing.status
          ? 'STATUS_CHANGED'
          : 'UPDATED';

    const history = this.recordHistory({
      fieldId: updated.id,
      entityCode: updated.entityCode,
      fieldKey: updated.fieldKey,
      actionType,
      changedFields: changedFields.length > 0 ? changedFields : ['updatedAt'],
      beforeSnapshot,
      afterSnapshot,
      reason: input.reason ?? 'Updated custom field configuration',
      actorUserId: actorId ?? null,
    });

    return { definition: updated, history };
  }

  /**
   * 9.8.5 — Cập nhật danh sách lựa chọn (`options`) có thứ tự (`sortOrder`) và trạng thái (`status`) cho trường `SELECT`.
   */
  public setFieldOptions(
    idOrEntityField: number | { readonly entityCode: string; readonly fieldKey: string },
    options: readonly CustomFieldOptionItem[],
    actorId?: number | null,
    reason?: string | null,
  ): {
    readonly definition: CustomFieldDefinitionRecord;
    readonly history: CustomFieldHistoryRecord;
  } {
    const existing =
      typeof idOrEntityField === 'number'
        ? this.definitionsById.get(idOrEntityField)
        : this.definitionsByKey.get(
            makeDefinitionKey(idOrEntityField.entityCode, idOrEntityField.fieldKey),
          );
    if (!existing) {
      throw new NotFoundAppException('customFields.definitionNotFound', {
        target:
          typeof idOrEntityField === 'number'
            ? idOrEntityField
            : `${idOrEntityField.entityCode}.${idOrEntityField.fieldKey}`,
      });
    }
    if (existing.dataType !== CUSTOM_FIELD_DATA_TYPE.SELECT) {
      throw new BadRequestAppException('customFields.optionsOnlyForSelectField', [
        { fieldKey: existing.fieldKey, dataType: existing.dataType },
      ]);
    }
    const activeOpts = options.filter((o) => o.status === CUSTOM_FIELD_STATUS.ACTIVE);
    const explicitDefault = activeOpts.find((o) => o.isDefault);
    const currentDefaultStillActive =
      existing.defaultValue !== null &&
      existing.defaultValue !== undefined &&
      activeOpts.some(
        (o) =>
          o.optionCode.trim().toLowerCase() ===
          String(existing.defaultValue).trim().toLowerCase(),
      );
    const nextDefaultValue = explicitDefault
      ? explicitDefault.optionCode
      : currentDefaultStillActive
        ? existing.defaultValue
        : null;

    return this.updateFieldDefinition(
      existing.id,
      {
        options,
        defaultValue: nextDefaultValue,
        reason: reason ?? 'Updated select options order and status',
      },
      actorId,
    );
  }

  public listFieldDefinitions(filter?: {
    readonly entityCode?: string | undefined;
    readonly module?: string | undefined;
    readonly dataType?: CustomFieldDataType | undefined;
    readonly isIndexed?: boolean | undefined;
    readonly status?: number | undefined;
  }): CustomFieldDefinitionRecord[] {
    this.ensureSynced();
    const targetEntity = filter?.entityCode ? normalizeEntityCode(filter.entityCode) : undefined;
    const targetModule = filter?.module?.trim().toLowerCase();

    return [...this.definitionsByKey.values()]
      .filter((d) => {
        if (targetEntity && d.entityCode !== targetEntity) return false;
        if (targetModule && d.module !== targetModule) return false;
        if (filter?.dataType && d.dataType !== filter.dataType) return false;
        if (filter?.isIndexed !== undefined && d.isIndexed !== filter.isIndexed) return false;
        if (filter?.status !== undefined && d.status !== Number(filter.status)) return false;
        return true;
      })
      .sort(
        (a, b) =>
          a.entityCode.localeCompare(b.entityCode) ||
          a.sortOrder - b.sortOrder ||
          a.id - b.id,
      );
  }

  public getFieldDefinitionById(id: number): CustomFieldDefinitionRecord | null {
    this.ensureSynced();
    return this.definitionsById.get(Number(id)) ?? null;
  }

  public getFieldDefinition(
    entityCode: string,
    fieldKey: string,
  ): CustomFieldDefinitionRecord | null {
    this.ensureSynced();
    return this.definitionsByKey.get(makeDefinitionKey(entityCode, fieldKey)) ?? null;
  }

  /**
   * 9.8.4 — Kiểm tra quyền XEM một trường tùy chỉnh của người gọi (`actor`).
   */
  public canActorViewField(
    field: CustomFieldDefinitionRecord,
    actor?: CustomFieldActorContext,
  ): boolean {
    if (!actor || actor.bypassPermissionCheck) {
      return !field.isSensitive || Boolean(actor?.bypassPermissionCheck);
    }

    const roles = new Set((actor.roles ?? []).map((r) => r.trim().toLowerCase()));
    const perms = new Set((actor.permissions ?? []).map((p) => p.trim()));

    if (roles.has('super_admin') || perms.has('*')) {
      return true;
    }

    const hasRoleRestriction = field.allowedViewRoles.length > 0;
    const hasPermRestriction = Boolean(field.viewPermission);

    if (!hasRoleRestriction && !hasPermRestriction) {
      if (field.isSensitive) {
        return (
          roles.has('admin') ||
          perms.has('custom-fields.sensitive.read') ||
          perms.has('custom-fields.manage')
        );
      }
      return true;
    }

    if (hasPermRestriction && field.viewPermission && perms.has(field.viewPermission)) {
      return true;
    }

    if (
      hasRoleRestriction &&
      field.allowedViewRoles.some((r) => roles.has(r.trim().toLowerCase()))
    ) {
      return true;
    }

    return false;
  }

  /**
   * 9.8.4 — Kiểm tra quyền SỬA một trường tùy chỉnh của người gọi (`actor`).
   */
  public canActorEditField(
    field: CustomFieldDefinitionRecord,
    actor?: CustomFieldActorContext,
  ): boolean {
    if (!actor || actor.bypassPermissionCheck) {
      return true;
    }

    const roles = new Set((actor.roles ?? []).map((r) => r.trim().toLowerCase()));
    const perms = new Set((actor.permissions ?? []).map((p) => p.trim()));

    if (roles.has('super_admin') || perms.has('*')) {
      return true;
    }

    const hasRoleRestriction = field.allowedEditRoles.length > 0;
    const hasPermRestriction = Boolean(field.editPermission);

    if (!hasRoleRestriction && !hasPermRestriction) {
      if (field.isSensitive) {
        return (
          roles.has('admin') ||
          perms.has('custom-fields.sensitive.write') ||
          perms.has('custom-fields.manage')
        );
      }
      return true;
    }

    if (hasPermRestriction && field.editPermission && perms.has(field.editPermission)) {
      return true;
    }

    if (
      hasRoleRestriction &&
      field.allowedEditRoles.some((r) => roles.has(r.trim().toLowerCase()))
    ) {
      return true;
    }

    return false;
  }

  /**
   * 9.8.3 & 9.8.5 — Kiểm tra bắt buộc (`isRequired`), kiểu dữ liệu và `validationRules` cho 1 trường.
   */
  public validateSingleFieldValueOrThrow(
    field: CustomFieldDefinitionRecord,
    rawValue: unknown,
    checkRequired = true,
  ): {
    readonly normalizedValue: unknown;
    readonly textValue: string | null;
    readonly numberValue: number | null;
    readonly dateValue: string | null;
    readonly booleanValue: boolean | null;
    readonly optionCode: string | null;
    readonly optionLabel: string | null;
  } {
    const isEmpty =
      rawValue === undefined ||
      rawValue === null ||
      (typeof rawValue === 'string' && rawValue.trim() === '');

    if (isEmpty) {
      if (checkRequired && field.isRequired) {
        throw new BadRequestAppException('customFields.requiredFieldMissing', [
          {
            entityCode: field.entityCode,
            fieldKey: field.fieldKey,
            name: field.name,
          },
        ]);
      }
      return {
        normalizedValue: null,
        textValue: null,
        numberValue: null,
        dateValue: null,
        booleanValue: null,
        optionCode: null,
        optionLabel: null,
      };
    }

    const rules = field.validationRules ?? {};

    switch (field.dataType) {
      case CUSTOM_FIELD_DATA_TYPE.TEXT: {
        if (typeof rawValue !== 'string') {
          throw new BadRequestAppException('customFields.invalidFieldValueType', [
            { fieldKey: field.fieldKey, expected: 'TEXT', received: typeof rawValue },
          ]);
        }
        const text = rawValue.trim();
        if (checkRequired && field.isRequired && text.length === 0) {
          throw new BadRequestAppException('customFields.requiredFieldMissing', [
            { entityCode: field.entityCode, fieldKey: field.fieldKey },
          ]);
        }
        if (rules.minLength !== undefined && text.length < rules.minLength) {
          throw new BadRequestAppException('customFields.textTooShort', [
            { fieldKey: field.fieldKey, minLength: rules.minLength, actualLength: text.length },
          ]);
        }
        if (rules.maxLength !== undefined && text.length > rules.maxLength) {
          throw new BadRequestAppException('customFields.textTooLong', [
            { fieldKey: field.fieldKey, maxLength: rules.maxLength, actualLength: text.length },
          ]);
        }
        if (rules.pattern) {
          const regex = new RegExp(rules.pattern);
          if (!regex.test(text)) {
            throw new BadRequestAppException('customFields.patternMismatch', [
              { fieldKey: field.fieldKey, pattern: rules.pattern },
            ]);
          }
        }
        return {
          normalizedValue: text,
          textValue: text.slice(0, 500),
          numberValue: null,
          dateValue: null,
          booleanValue: null,
          optionCode: null,
          optionLabel: null,
        };
      }

      case CUSTOM_FIELD_DATA_TYPE.NUMBER: {
        const num = typeof rawValue === 'number' ? rawValue : Number(rawValue);
        if (typeof rawValue === 'boolean' || Number.isNaN(num) || !Number.isFinite(num)) {
          throw new BadRequestAppException('customFields.invalidFieldValueType', [
            { fieldKey: field.fieldKey, expected: 'NUMBER', received: rawValue },
          ]);
        }
        if (rules.integerOnly && !Number.isInteger(num)) {
          throw new BadRequestAppException('customFields.integerRequired', [
            { fieldKey: field.fieldKey, received: num },
          ]);
        }
        if (rules.min !== undefined && num < rules.min) {
          throw new BadRequestAppException('customFields.numberBelowMin', [
            { fieldKey: field.fieldKey, min: rules.min, received: num },
          ]);
        }
        if (rules.max !== undefined && num > rules.max) {
          throw new BadRequestAppException('customFields.numberAboveMax', [
            { fieldKey: field.fieldKey, max: rules.max, received: num },
          ]);
        }
        return {
          normalizedValue: num,
          textValue: String(num),
          numberValue: num,
          dateValue: null,
          booleanValue: null,
          optionCode: null,
          optionLabel: null,
        };
      }

      case CUSTOM_FIELD_DATA_TYPE.DATE: {
        const dateStr = rawValue instanceof Date ? rawValue.toISOString() : String(rawValue).trim();
        const parsedMs = new Date(dateStr).getTime();
        if (Number.isNaN(parsedMs)) {
          throw new BadRequestAppException('customFields.invalidDateValue', [
            { fieldKey: field.fieldKey, received: rawValue },
          ]);
        }
        const isoDate = dateStr.length === 10 ? dateStr : new Date(parsedMs).toISOString().slice(0, 10);
        if (rules.minDate) {
          const minMs = new Date(rules.minDate).getTime();
          if (!Number.isNaN(minMs) && parsedMs < minMs) {
            throw new BadRequestAppException('customFields.dateBeforeMin', [
              { fieldKey: field.fieldKey, minDate: rules.minDate, received: isoDate },
            ]);
          }
        }
        if (rules.maxDate) {
          const maxMs = new Date(rules.maxDate).getTime();
          if (!Number.isNaN(maxMs) && parsedMs > maxMs) {
            throw new BadRequestAppException('customFields.dateAfterMax', [
              { fieldKey: field.fieldKey, maxDate: rules.maxDate, received: isoDate },
            ]);
          }
        }
        return {
          normalizedValue: isoDate,
          textValue: isoDate,
          numberValue: null,
          dateValue: isoDate,
          booleanValue: null,
          optionCode: null,
          optionLabel: null,
        };
      }

      case CUSTOM_FIELD_DATA_TYPE.BOOLEAN: {
        let boolVal: boolean;
        if (typeof rawValue === 'boolean') {
          boolVal = rawValue;
        } else if (rawValue === 'true' || rawValue === 1 || rawValue === '1') {
          boolVal = true;
        } else if (rawValue === 'false' || rawValue === 0 || rawValue === '0') {
          boolVal = false;
        } else {
          throw new BadRequestAppException('customFields.invalidFieldValueType', [
            { fieldKey: field.fieldKey, expected: 'BOOLEAN', received: rawValue },
          ]);
        }
        return {
          normalizedValue: boolVal,
          textValue: String(boolVal),
          numberValue: boolVal ? 1 : 0,
          dateValue: null,
          booleanValue: boolVal,
          optionCode: null,
          optionLabel: null,
        };
      }

      case CUSTOM_FIELD_DATA_TYPE.SELECT: {
        const selectedCode = String(rawValue).trim();
        const activeOptions = this.resolveActiveSelectOptions(field);
        const matched = activeOptions.find(
          (o) => o.optionCode.toLowerCase() === selectedCode.toLowerCase(),
        );
        if (!matched) {
          throw new BadRequestAppException('customFields.invalidOrInactiveSelectOption', [
            {
              fieldKey: field.fieldKey,
              received: selectedCode,
              allowedActiveOptions: activeOptions.map((o) => o.optionCode),
            },
          ]);
        }
        return {
          normalizedValue: matched.optionCode,
          textValue: matched.label,
          numberValue: null,
          dateValue: null,
          booleanValue: null,
          optionCode: matched.optionCode,
          optionLabel: matched.label,
        };
      }
    }
  }

  public resolveActiveSelectOptions(field: CustomFieldDefinitionRecord): CustomFieldOptionItem[] {
    const directActive = field.options.filter((o) => o.status === CUSTOM_FIELD_STATUS.ACTIVE);
    if (directActive.length > 0 || !field.codeTypeCode) {
      return directActive;
    }
    const codeValues = defaultCodeRegistry.listValues(field.codeTypeCode, {
      includeInactive: false,
    });
    return codeValues.map((cv) => ({
      optionCode: cv.code,
      label: cv.label,
      ...(cv.labels ? { labels: cv.labels } : {}),
      color: cv.color ?? null,
      sortOrder: cv.sortOrder,
      isDefault: cv.isDefault,
      status: CUSTOM_FIELD_STATUS.ACTIVE,
    }));
  }

  /**
   * 9.8.3, 9.8.4 & 9.8.5 — Lưu giá trị trường tùy chỉnh cho 1 bản ghi (`entityCode` + `recordId`),
   * tự động kiểm tra quyền sửa (`canActorEditField`), kiểm tra bắt buộc (`isRequired` khi `mode === 'create'`),
   * và kiểm tra `validationRules`.
   */
  public setRecordCustomFields(params: {
    readonly entityCode: string;
    readonly recordId: string | number;
    readonly values: Readonly<Record<string, unknown>>;
    readonly mode?: 'create' | 'update' | undefined;
    readonly actor?: CustomFieldActorContext | undefined;
    readonly validateOnly?: boolean | undefined;
  }): CustomFieldValueRecord[] {
    const entity = this.ensureExtensibleEntityAllowed(params.entityCode);
    const cleanRecordId = String(params.recordId).trim();
    const activeDefs = this.listFieldDefinitions({
      entityCode: entity.code,
      status: CUSTOM_FIELD_STATUS.ACTIVE,
    });
    const defByKey = new Map(activeDefs.map((d) => [d.fieldKey.toLowerCase(), d]));

    // 1. Kiểm tra các key truyền vào có hợp lệ và có quyền sửa hay không (9.8.4)
    for (const [inputKey, rawVal] of Object.entries(params.values)) {
      const def = defByKey.get(inputKey.trim().toLowerCase());
      if (!def) {
        throw new BadRequestAppException('customFields.unknownCustomFieldKey', [
          { entityCode: entity.code, fieldKey: inputKey },
        ]);
      }
      if (!this.canActorEditField(def, params.actor)) {
        throw new ForbiddenAppException('customFields.fieldEditForbidden', [
          {
            entityCode: entity.code,
            fieldKey: def.fieldKey,
            editPermission: def.editPermission,
            allowedEditRoles: def.allowedEditRoles,
          },
        ]);
      }
      void rawVal;
    }

    const savedRecords: CustomFieldValueRecord[] = [];
    const isCreateMode = (params.mode ?? 'update') === 'create';

    for (const def of activeDefs) {
      const hasInputKey = Object.prototype.hasOwnProperty.call(params.values, def.fieldKey);
      const existingValKey = makeValueKey(entity.code, cleanRecordId, def.fieldKey);
      const existingVal = this.valuesByKey.get(existingValKey);

      if (!hasInputKey) {
        if (isCreateMode) {
          const initialRaw = def.defaultValue !== null && def.defaultValue !== undefined ? def.defaultValue : undefined;
          const validated = this.validateSingleFieldValueOrThrow(def, initialRaw, true);
          if (validated.normalizedValue !== null && !params.validateOnly) {
            const valRecord: CustomFieldValueRecord = {
              id: existingVal?.id ?? this.nextValueId++,
              fieldId: def.id,
              entityCode: entity.code,
              fieldKey: def.fieldKey,
              recordId: cleanRecordId,
              dataType: def.dataType,
              value: validated.normalizedValue,
              textValue: validated.textValue,
              numberValue: validated.numberValue,
              dateValue: validated.dateValue,
              booleanValue: validated.booleanValue,
              optionCode: validated.optionCode,
              optionLabel: validated.optionLabel,
              isEncrypted: def.isSensitive,
              updatedBy: params.actor?.id ?? null,
              updatedAt: new Date().toISOString(),
            };
            this.valuesByKey.set(existingValKey, valRecord);
            savedRecords.push(valRecord);
          }
        }
        continue;
      }

      const rawVal = params.values[def.fieldKey];
      const validated = this.validateSingleFieldValueOrThrow(def, rawVal, true);
      if (!params.validateOnly) {
        const valRecord: CustomFieldValueRecord = {
          id: existingVal?.id ?? this.nextValueId++,
          fieldId: def.id,
          entityCode: entity.code,
          fieldKey: def.fieldKey,
          recordId: cleanRecordId,
          dataType: def.dataType,
          value: validated.normalizedValue,
          textValue: validated.textValue,
          numberValue: validated.numberValue,
          dateValue: validated.dateValue,
          booleanValue: validated.booleanValue,
          optionCode: validated.optionCode,
          optionLabel: validated.optionLabel,
          isEncrypted: def.isSensitive,
          updatedBy: params.actor?.id ?? null,
          updatedAt: new Date().toISOString(),
        };
        this.valuesByKey.set(existingValKey, valRecord);
        savedRecords.push(valRecord);
      }
    }

    return savedRecords;
  }

  /**
   * 9.8.4 & 9.8.6 — Trả về tập trường tùy chỉnh của một bản ghi để hiển thị trong API
   * theo đúng cấu hình (`showInApi`, `showInList` / `showInDetail`) và quyền xem (`canActorViewField`).
   */
  public resolveRecordCustomFieldsForApi(params: {
    readonly entityCode: string;
    readonly recordId: string | number;
    readonly viewMode?: 'list' | 'detail' | undefined;
    readonly actor?: CustomFieldActorContext | undefined;
  }): Record<string, unknown> {
    this.ensureSynced();
    const cleanEntity = normalizeEntityCode(params.entityCode);
    const cleanRecordId = String(params.recordId).trim();
    const mode = params.viewMode ?? 'detail';

    const activeDefs = this.listFieldDefinitions({
      entityCode: cleanEntity,
      status: CUSTOM_FIELD_STATUS.ACTIVE,
    });

    const result: Record<string, unknown> = {};
    for (const def of activeDefs) {
      if (!def.showInApi) continue;
      if (mode === 'list' && !def.showInList) continue;
      if (mode === 'detail' && !def.showInDetail) continue;
      if (!this.canActorViewField(def, params.actor)) continue;

      const valKey = makeValueKey(cleanEntity, cleanRecordId, def.fieldKey);
      const stored = this.valuesByKey.get(valKey);
      result[def.fieldKey] = stored ? stored.value : (def.defaultValue ?? null);
    }

    return result;
  }

  /**
   * 9.8.6 — Giải quyết hàng loạt `customFields` cho danh sách bản ghi (`recordIds`) để tránh lặp.
   */
  public resolveBatchRecordsCustomFieldsForApi(params: {
    readonly entityCode: string;
    readonly recordIds: readonly (string | number)[];
    readonly viewMode?: 'list' | 'detail' | undefined;
    readonly actor?: CustomFieldActorContext | undefined;
  }): Map<string, Record<string, unknown>> {
    const map = new Map<string, Record<string, unknown>>();
    for (const recordId of params.recordIds) {
      const key = String(recordId).trim();
      map.set(
        key,
        this.resolveRecordCustomFieldsForApi({
          entityCode: params.entityCode,
          recordId: key,
          viewMode: params.viewMode ?? 'list',
          actor: params.actor,
        }),
      );
    }
    return map;
  }

  /**
   * 9.8.7 — Lọc danh sách `recordId` theo điều kiện trường tùy chỉnh.
   * BẮT BUỘC kiểm tra `isIndexed === true` trên từng trường được lọc; nếu trường chưa đánh index thì ném lỗi ngay!
   */
  public filterRecordIdsByCustomFields(params: {
    readonly entityCode: string;
    readonly filters: readonly CustomFieldFilterCondition[];
    readonly actor?: CustomFieldActorContext | undefined;
  }): string[] {
    const entity = this.ensureExtensibleEntityAllowed(params.entityCode);
    if (params.filters.length === 0) return [];

    let matchedRecordIds: Set<string> | null = null;

    for (const cond of params.filters) {
      const def = this.getFieldDefinition(entity.code, cond.fieldKey);
      if (!def || def.status !== CUSTOM_FIELD_STATUS.ACTIVE) {
        throw new BadRequestAppException('customFields.unknownCustomFieldKey', [
          { entityCode: entity.code, fieldKey: cond.fieldKey },
        ]);
      }

      // 9.8.7 — Chỉ field được đánh index (`isIndexed: true`) mới cho phép lọc!
      if (!def.isIndexed) {
        throw new BadRequestAppException('customFields.fieldNotIndexedForFilter', [
          {
            entityCode: entity.code,
            fieldKey: def.fieldKey,
            isIndexed: false,
            message: `Custom field '${def.fieldKey}' is not indexed and cannot be used for filtering`,
          },
        ]);
      }

      if (!this.canActorViewField(def, params.actor)) {
        throw new ForbiddenAppException('customFields.fieldViewForbiddenForFilter', [
          { entityCode: entity.code, fieldKey: def.fieldKey },
        ]);
      }

      const op = cond.operator ?? 'eq';
      const currentMatched = new Set<string>();

      for (const valRecord of this.valuesByKey.values()) {
        if (valRecord.entityCode !== entity.code) continue;
        if (valRecord.fieldKey.toLowerCase() !== def.fieldKey.toLowerCase()) continue;
        if (this.matchesCondition(def, valRecord, op, cond.value)) {
          currentMatched.add(valRecord.recordId);
        }
      }

      if (matchedRecordIds === null) {
        matchedRecordIds = currentMatched;
      } else {
        for (const id of [...matchedRecordIds]) {
          if (!currentMatched.has(id)) {
            matchedRecordIds.delete(id);
          }
        }
      }
    }

    return matchedRecordIds ? [...matchedRecordIds] : [];
  }

  private matchesCondition(
    def: CustomFieldDefinitionRecord,
    record: CustomFieldValueRecord,
    operator: string,
    target: unknown,
  ): boolean {
    const actual = record.value;
    if (actual === null || actual === undefined) return false;

    switch (operator) {
      case 'eq':
        if (def.dataType === CUSTOM_FIELD_DATA_TYPE.NUMBER) {
          return Number(actual) === Number(target);
        }
        if (def.dataType === CUSTOM_FIELD_DATA_TYPE.BOOLEAN) {
          const targetBool =
            typeof target === 'boolean' ? target : String(target).toLowerCase() === 'true';
          return Boolean(actual) === targetBool;
        }
        return String(actual).toLowerCase() === String(target ?? '').trim().toLowerCase();

      case 'ne':
        return String(actual).toLowerCase() !== String(target ?? '').trim().toLowerCase();

      case 'contains':
        return String(actual)
          .toLowerCase()
          .includes(String(target ?? '').trim().toLowerCase());

      case 'gt':
        if (def.dataType === CUSTOM_FIELD_DATA_TYPE.NUMBER) {
          return Number(actual) > Number(target);
        }
        return String(actual) > String(target);

      case 'gte':
        if (def.dataType === CUSTOM_FIELD_DATA_TYPE.NUMBER) {
          return Number(actual) >= Number(target);
        }
        return String(actual) >= String(target);

      case 'lt':
        if (def.dataType === CUSTOM_FIELD_DATA_TYPE.NUMBER) {
          return Number(actual) < Number(target);
        }
        return String(actual) < String(target);

      case 'lte':
        if (def.dataType === CUSTOM_FIELD_DATA_TYPE.NUMBER) {
          return Number(actual) <= Number(target);
        }
        return String(actual) <= String(target);

      case 'in': {
        const list = Array.isArray(target)
          ? target.map((v) => String(v).trim().toLowerCase())
          : String(target ?? '')
              .split(',')
              .map((v) => v.trim().toLowerCase());
        return list.includes(String(actual).toLowerCase());
      }

      default:
        return false;
    }
  }

  public listRecordValues(entityCode: string, recordId: string | number): CustomFieldValueRecord[] {
    const cleanEntity = normalizeEntityCode(entityCode);
    const cleanRecordId = String(recordId).trim();
    return [...this.valuesByKey.values()].filter(
      (v) => v.entityCode === cleanEntity && v.recordId === cleanRecordId,
    );
  }

  public countValuesByField(entityCode: string, fieldKey: string): number {
    const cleanEntity = normalizeEntityCode(entityCode);
    const cleanKey = fieldKey.trim().toLowerCase();
    let count = 0;
    for (const v of this.valuesByKey.values()) {
      if (
        v.entityCode === cleanEntity &&
        v.fieldKey.toLowerCase() === cleanKey &&
        v.value !== null &&
        v.value !== undefined
      ) {
        count++;
      }
    }
    return count;
  }

  /**
   * 9.8.8 — Xem danh sách lịch sử thay đổi cấu hình trường tùy chỉnh.
   */
  public listFieldHistories(filter?: {
    readonly fieldId?: number | undefined;
    readonly entityCode?: string | undefined;
    readonly fieldKey?: string | undefined;
    readonly limit?: number | undefined;
  }): CustomFieldHistoryRecord[] {
    const cleanEntity = filter?.entityCode ? normalizeEntityCode(filter.entityCode) : undefined;
    const cleanKey = filter?.fieldKey?.trim().toLowerCase();
    const limit = Math.max(1, Math.min(200, filter?.limit ?? 50));

    return this.histories
      .filter((h) => {
        if (filter?.fieldId !== undefined && h.fieldId !== Number(filter.fieldId)) return false;
        if (cleanEntity && h.entityCode !== cleanEntity) return false;
        if (cleanKey && h.fieldKey.toLowerCase() !== cleanKey) return false;
        return true;
      })
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);
  }

  public recordHistory(input: {
    readonly fieldId: number;
    readonly entityCode: string;
    readonly fieldKey: string;
    readonly actionType: CustomFieldHistoryActionType;
    readonly changedFields: readonly string[];
    readonly beforeSnapshot: Readonly<Record<string, unknown>> | null;
    readonly afterSnapshot: Readonly<Record<string, unknown>> | null;
    readonly reason: string | null;
    readonly actorUserId: number | null;
  }): CustomFieldHistoryRecord {
    const record: CustomFieldHistoryRecord = {
      id: this.nextHistoryId++,
      fieldId: input.fieldId,
      entityCode: normalizeEntityCode(input.entityCode),
      fieldKey: input.fieldKey,
      actionType: input.actionType,
      changedFields: [...input.changedFields],
      beforeSnapshot: input.beforeSnapshot,
      afterSnapshot: input.afterSnapshot,
      reason: input.reason,
      actorUserId: input.actorUserId,
      createdAt: new Date().toISOString(),
    };
    this.histories.push(record);
    return record;
  }

  private toSnapshot(def: CustomFieldDefinitionRecord): Record<string, unknown> {
    return {
      name: def.name,
      description: def.description,
      dataType: def.dataType,
      defaultValue: def.defaultValue,
      validationRules: def.validationRules,
      options: def.options,
      codeTypeCode: def.codeTypeCode,
      isRequired: def.isRequired,
      isIndexed: def.isIndexed,
      showInApi: def.showInApi,
      showInList: def.showInList,
      showInDetail: def.showInDetail,
      isSensitive: def.isSensitive,
      viewPermission: def.viewPermission,
      editPermission: def.editPermission,
      allowedViewRoles: def.allowedViewRoles,
      allowedEditRoles: def.allowedEditRoles,
      sortOrder: def.sortOrder,
      status: def.status,
      version: def.version,
    };
  }
}

export const defaultCustomFieldRegistry = new CustomFieldRegistryService();

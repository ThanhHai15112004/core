import {
  CUSTOM_FIELD_DATA_TYPE,
  CUSTOM_FIELD_STATUS,
  safeJsonParse,
  safeJsonParseObject,
  safeJsonParseStringArray,
  type CustomFieldDataType,
  type CustomFieldDefinitionRecord,
  type CustomFieldHistoryActionType,
  type CustomFieldHistoryRecord,
  type CustomFieldOptionItem,
  type CustomFieldStatusCode,
  type CustomFieldValidationRules,
  type CustomFieldValueRecord,
} from '@packages/kernel/index.js';
import {
  defaultFieldEncryptionService,
  type FieldEncryptionService,
} from '@packages/security/index.js';
import type { CustomFieldDefinitionEntity } from '../entities/custom-field-definition.entity.js';
import type { CustomFieldHistoryEntity } from '../entities/custom-field-history.entity.js';
import type { CustomFieldOptionEntity } from '../entities/custom-field-option.entity.js';
import type { CustomFieldValueEntity } from '../entities/custom-field-value.entity.js';

export function mapOptionEntityToItem(entity: CustomFieldOptionEntity): CustomFieldOptionItem {
  return {
    optionCode: entity.optionCode,
    label: entity.optionLabel,
    labels: safeJsonParseObject<Record<string, string>>(entity.labelsJson ?? '{}'),
    color: entity.color ?? null,
    sortOrder: Number(entity.sortOrder ?? 1),
    isDefault: Boolean(entity.isDefault),
    status: (entity.status ?? CUSTOM_FIELD_STATUS.ACTIVE) as CustomFieldStatusCode,
  };
}

export function mapDefinitionEntityToRecord(
  entity: CustomFieldDefinitionEntity,
  options: CustomFieldOptionEntity[],
): CustomFieldDefinitionRecord {
  return {
    id: Number(entity.id),
    entityCode: entity.entityCode,
    fieldKey: entity.fieldKey,
    module: entity.module || 'custom',
    name: entity.name,
    description: entity.description ?? null,
    dataType: (entity.dataType ?? CUSTOM_FIELD_DATA_TYPE.TEXT) as CustomFieldDataType,
    defaultValue:
      entity.defaultValueJson !== null && entity.defaultValueJson !== undefined
        ? safeJsonParse<unknown>(entity.defaultValueJson, entity.defaultValueJson)
        : null,
    validationRules: entity.validationRulesJson
      ? safeJsonParse<CustomFieldValidationRules | null>(entity.validationRulesJson, null)
      : null,
    options: options
      .map(mapOptionEntityToItem)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.optionCode.localeCompare(b.optionCode)),
    codeTypeCode: entity.codeTypeCode ?? null,
    isRequired: Boolean(entity.isRequired),
    isIndexed: Boolean(entity.isIndexed),
    showInApi: entity.showInApi ?? true,
    showInList: entity.showInList ?? true,
    showInDetail: entity.showInDetail ?? true,
    isSensitive: Boolean(entity.isSensitive),
    viewPermission: entity.viewPermission ?? null,
    editPermission: entity.editPermission ?? null,
    allowedViewRoles: safeJsonParseStringArray(entity.allowedViewRolesJson ?? '[]'),
    allowedEditRoles: safeJsonParseStringArray(entity.allowedEditRolesJson ?? '[]'),
    sortOrder: Number(entity.sortOrder ?? 1),
    isSystem: Boolean(entity.isSystem),
    status: (entity.status ?? CUSTOM_FIELD_STATUS.ACTIVE) as CustomFieldStatusCode,
    version: Number(entity.version ?? 1),
    createdBy: entity.createdBy !== null && entity.createdBy !== undefined ? Number(entity.createdBy) : null,
    updatedBy: entity.updatedBy !== null && entity.updatedBy !== undefined ? Number(entity.updatedBy) : null,
    createdAt:
      entity.createdAt instanceof Date
        ? entity.createdAt.toISOString()
        : String(entity.createdAt ?? new Date().toISOString()),
    updatedAt:
      entity.updatedAt instanceof Date
        ? entity.updatedAt.toISOString()
        : String(entity.updatedAt ?? new Date().toISOString()),
  };
}

export function mapDefinitionRecordToEntityPayload(
  record: CustomFieldDefinitionRecord,
): Partial<CustomFieldDefinitionEntity> & { entityCode: string; fieldKey: string } {
  return {
    entityCode: record.entityCode,
    fieldKey: record.fieldKey,
    module: record.module,
    name: record.name,
    description: record.description,
    dataType: record.dataType,
    defaultValueJson:
      record.defaultValue !== null && record.defaultValue !== undefined
        ? JSON.stringify(record.defaultValue)
        : null,
    validationRulesJson: record.validationRules
      ? JSON.stringify(record.validationRules)
      : null,
    codeTypeCode: record.codeTypeCode,
    isRequired: record.isRequired,
    isIndexed: record.isIndexed,
    showInApi: record.showInApi,
    showInList: record.showInList,
    showInDetail: record.showInDetail,
    isSensitive: record.isSensitive,
    viewPermission: record.viewPermission,
    editPermission: record.editPermission,
    allowedViewRolesJson: JSON.stringify(record.allowedViewRoles ?? []),
    allowedEditRolesJson: JSON.stringify(record.allowedEditRoles ?? []),
    sortOrder: record.sortOrder,
    isSystem: record.isSystem,
    status: record.status,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
  };
}

export function mapValueEntityToRecord(
  entity: CustomFieldValueEntity,
  encryptionService: FieldEncryptionService = defaultFieldEncryptionService,
): CustomFieldValueRecord {
  let value: unknown = entity.valueJson
    ? safeJsonParse<unknown>(entity.valueJson, entity.valueJson)
    : (entity.valueText ?? entity.valueNumber ?? entity.valueDate ?? entity.valueBoolean ?? null);

  if (entity.encryptedValue) {
    try {
      const decrypted = encryptionService.decrypt(entity.encryptedValue);
      value = safeJsonParse<unknown>(decrypted, decrypted);
    } catch {
      // Fallback if key rotated
    }
  }

  return {
    id: Number(entity.id),
    fieldId: Number(entity.fieldId),
    entityCode: entity.entityCode,
    fieldKey: entity.fieldKey,
    recordId: String(entity.recordId),
    dataType: (entity.dataType ?? CUSTOM_FIELD_DATA_TYPE.TEXT) as CustomFieldDataType,
    value,
    textValue: entity.valueText ?? null,
    numberValue:
      entity.valueNumber !== null && entity.valueNumber !== undefined
        ? Number(entity.valueNumber)
        : null,
    dateValue: entity.valueDate ?? null,
    booleanValue:
      entity.valueBoolean !== null && entity.valueBoolean !== undefined
        ? Boolean(entity.valueBoolean)
        : null,
    optionCode: entity.optionCode ?? null,
    optionLabel: entity.optionLabel ?? null,
    isEncrypted: Boolean(entity.encryptedValue),
    updatedBy:
      entity.updatedByUserId !== null && entity.updatedByUserId !== undefined
        ? Number(entity.updatedByUserId)
        : null,
    updatedAt:
      entity.updatedAt instanceof Date
        ? entity.updatedAt.toISOString()
        : String(entity.updatedAt ?? new Date().toISOString()),
  };
}

export function mapValueRecordToEntityPayload(
  record: CustomFieldValueRecord,
  isIndexed: boolean,
  encryptionService: FieldEncryptionService = defaultFieldEncryptionService,
): Partial<CustomFieldValueEntity> & {
  entityCode: string;
  recordId: string;
  fieldKey: string;
} {
  const encryptedPayload = record.isEncrypted
    ? encryptionService.encrypt(JSON.stringify(record.value))
    : null;

  return {
    entityCode: record.entityCode,
    recordId: String(record.recordId),
    fieldId: String(record.fieldId),
    fieldKey: record.fieldKey,
    dataType: record.dataType,
    valueText: record.isEncrypted && !isIndexed ? null : record.textValue,
    valueNumber:
      record.isEncrypted && !isIndexed
        ? null
        : record.numberValue !== null && record.numberValue !== undefined
          ? String(record.numberValue)
          : null,
    valueDate: record.isEncrypted && !isIndexed ? null : record.dateValue,
    valueBoolean: record.isEncrypted && !isIndexed ? null : record.booleanValue,
    optionCode: record.isEncrypted && !isIndexed ? null : record.optionCode,
    optionLabel: record.isEncrypted && !isIndexed ? null : (record.optionLabel ?? null),
    valueJson: record.isEncrypted ? null : JSON.stringify(record.value),
    encryptedValue: encryptedPayload,
    updatedByUserId: record.updatedBy !== null && record.updatedBy !== undefined ? String(record.updatedBy) : null,
  };
}

export function mapHistoryEntityToRecord(
  entity: CustomFieldHistoryEntity,
): CustomFieldHistoryRecord {
  return {
    id: Number(entity.id),
    fieldId: Number(entity.fieldId),
    entityCode: entity.entityCode,
    fieldKey: entity.fieldKey,
    actionType: (entity.actionType || 'UPDATED') as CustomFieldHistoryActionType,
    changedFields: safeJsonParseStringArray(entity.changedFieldsJson ?? '[]'),
    beforeSnapshot: entity.beforeSnapshotJson
      ? safeJsonParseObject<Record<string, unknown>>(entity.beforeSnapshotJson)
      : null,
    afterSnapshot: entity.afterSnapshotJson
      ? safeJsonParseObject<Record<string, unknown>>(entity.afterSnapshotJson)
      : null,
    reason: entity.reason ?? null,
    actorUserId:
      entity.actorUserId !== null && entity.actorUserId !== undefined
        ? Number(entity.actorUserId)
        : null,
    createdAt:
      entity.createdAt instanceof Date
        ? entity.createdAt.toISOString()
        : String(entity.createdAt ?? new Date().toISOString()),
  };
}

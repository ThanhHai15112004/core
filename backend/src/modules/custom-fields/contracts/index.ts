import type {
  CustomFieldActorContext,
  CustomFieldDefinitionRecord,
  CustomFieldFilterCondition,
  CustomFieldHistoryRecord,
  CustomFieldOptionItem,
  CustomFieldValueRecord,
  RegisteredExtensibleEntity,
} from '@packages/kernel/index.js';

export const CUSTOM_FIELDS_PUBLIC_SERVICE = Symbol('CUSTOM_FIELDS_PUBLIC_SERVICE');

export interface ICustomFieldsPublicService {
  getRegisteredEntities(): RegisteredExtensibleEntity[];
  listDefinitionsByEntity(
    entityCode: string,
    includeInactive?: boolean,
  ): Promise<CustomFieldDefinitionRecord[]>;
  getRecordValuesForApi(
    entityCode: string,
    recordId: string | number,
    options?: {
      viewMode?: 'list' | 'detail';
      actor?: CustomFieldActorContext;
    },
  ): Promise<Record<string, unknown>>;
  getBatchRecordValuesForApi(
    entityCode: string,
    recordIds: readonly (string | number)[],
    options?: {
      viewMode?: 'list' | 'detail';
      actor?: CustomFieldActorContext;
    },
  ): Promise<Map<string, Record<string, unknown>>>;
  validateAndSaveRecordValues(params: {
    entityCode: string;
    recordId: string | number;
    values: Record<string, unknown>;
    mode?: 'create' | 'update';
    actor?: CustomFieldActorContext;
  }): Promise<CustomFieldValueRecord[]>;
  filterRecordIdsByCustomFields(params: {
    entityCode: string;
    filters: readonly CustomFieldFilterCondition[];
    actor?: CustomFieldActorContext;
  }): Promise<string[]>;
  updateFieldOptions(
    definitionId: number,
    options: readonly CustomFieldOptionItem[],
    actorUserId?: number | null,
    reason?: string | null,
  ): Promise<CustomFieldDefinitionRecord>;
  listHistories(params?: {
    fieldId?: number;
    entityCode?: string;
    fieldKey?: string;
    limit?: number;
  }): Promise<CustomFieldHistoryRecord[]>;
}

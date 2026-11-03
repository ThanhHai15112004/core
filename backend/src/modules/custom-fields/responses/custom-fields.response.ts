import {
  CUSTOM_FIELD_STATUS,
  type CustomFieldDataType,
  type CustomFieldDefinitionRecord,
  type CustomFieldHistoryRecord,
  type CustomFieldOptionItem,
  type CustomFieldStatusCode,
  type CustomFieldValidationRules,
  type CustomFieldValueRecord,
  type RegisteredExtensibleEntity,
} from '@packages/kernel/index.js';

export interface ExtensibleEntityResponse extends RegisteredExtensibleEntity {
  readonly totalFieldsCount: number;
  readonly activeFieldsCount: number;
  readonly indexedFieldsCount: number;
}

export interface CustomFieldDefinitionResponse {
  readonly id: number;
  readonly entityCode: string;
  readonly module: string;
  readonly fieldKey: string;
  readonly name: string;
  readonly description: string | null;
  readonly dataType: CustomFieldDataType;
  readonly defaultValue: unknown;
  readonly validationRules: CustomFieldValidationRules | null;
  readonly options: readonly CustomFieldOptionItem[];
  readonly codeTypeCode: string | null;
  readonly isRequired: boolean;
  readonly isIndexed: boolean;
  readonly showInApi: boolean;
  readonly showInList: boolean;
  readonly showInDetail: boolean;
  readonly isSensitive: boolean;
  readonly viewPermission: string | null;
  readonly editPermission: string | null;
  readonly allowedViewRoles: readonly string[];
  readonly allowedEditRoles: readonly string[];
  readonly sortOrder: number;
  readonly isSystem: boolean;
  readonly status: CustomFieldStatusCode;
  readonly statusName: 'ACTIVE' | 'INACTIVE';
  readonly version: number;
  readonly createdBy: number | null;
  readonly updatedBy: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type CustomFieldHistoryResponse = CustomFieldHistoryRecord;

export interface CustomFieldRecordValuesResponse {
  readonly entityCode: string;
  readonly recordId: string;
  readonly values: Record<string, unknown>;
  readonly rawEntries?: readonly CustomFieldValueRecord[];
}

export class CustomFieldResponseMapper {
  public static toEntityResponse(
    entity: RegisteredExtensibleEntity,
    definitions: readonly CustomFieldDefinitionRecord[],
  ): ExtensibleEntityResponse {
    const entityDefs = definitions.filter((d) => d.entityCode === entity.code);
    const activeDefs = entityDefs.filter((d) => d.status === CUSTOM_FIELD_STATUS.ACTIVE);
    return {
      ...entity,
      totalFieldsCount: entityDefs.length,
      activeFieldsCount: activeDefs.length,
      indexedFieldsCount: activeDefs.filter((d) => d.isIndexed).length,
    };
  }

  public static toDefinitionResponse(
    record: CustomFieldDefinitionRecord,
  ): CustomFieldDefinitionResponse {
    return {
      ...record,
      statusName: record.status === CUSTOM_FIELD_STATUS.INACTIVE ? 'INACTIVE' : 'ACTIVE',
    };
  }

  public static toHistoryResponse(record: CustomFieldHistoryRecord): CustomFieldHistoryResponse {
    return { ...record };
  }
}

export type CustomFieldDataType = 'TEXT' | 'NUMBER' | 'DATE' | 'BOOLEAN' | 'SELECT';

export type CustomFieldFilterOperator =
  | 'eq'
  | 'ne'
  | 'contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in';

export interface CustomFieldValidationRules {
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  min?: number;
  max?: number;
  integerOnly?: boolean;
  minDate?: string;
  maxDate?: string;
}

export interface CustomFieldOptionItem {
  optionCode: string;
  label: string;
  labels?: Record<string, string>;
  color: string | null;
  sortOrder: number;
  isDefault: boolean;
  status: number;
}

export interface CustomFieldDefinitionItem {
  id: number;
  entityCode: string;
  module: string;
  fieldKey: string;
  name: string;
  description: string | null;
  dataType: CustomFieldDataType;
  isRequired: boolean;
  defaultValue: unknown;
  validationRules: CustomFieldValidationRules | null;
  codeTypeCode: string | null;
  viewPermission: string | null;
  editPermission: string | null;
  allowedViewRoles: string[];
  allowedEditRoles: string[];
  isSensitive: boolean;
  showInApi: boolean;
  showInList: boolean;
  showInDetail: boolean;
  isIndexed: boolean;
  sortOrder: number;
  status: number;
  statusName: 'ACTIVE' | 'INACTIVE';
  isSystem: boolean;
  version: number;
  options: CustomFieldOptionItem[];
  createdAt: string;
  updatedAt: string;
}

export interface ExtensibleEntityItem {
  code: string;
  module: string;
  name: string;
  description: string | null;
  totalFieldsCount: number;
  activeFieldsCount: number;
  indexedFieldsCount: number;
}

export interface CustomFieldHistoryItem {
  id: number;
  fieldId: number;
  entityCode: string;
  fieldKey: string;
  actionType: string;
  changedFields: string[];
  beforeSnapshot: Record<string, unknown> | null;
  afterSnapshot: Record<string, unknown> | null;
  actorUserId: number | null;
  reason: string | null;
  createdAt: string;
}

export interface RecordCustomFieldsPayload {
  entityCode: string;
  recordId: string;
  values: Record<string, unknown>;
}

export interface CustomFieldFilterCondition {
  fieldKey: string;
  operator?: CustomFieldFilterOperator;
  value: unknown;
}

export interface FilterRecordsByCustomFieldsResult {
  entityCode: string;
  matchedRecordIds: string[];
  totalMatched: number;
  appliedFilters: CustomFieldFilterCondition[];
}

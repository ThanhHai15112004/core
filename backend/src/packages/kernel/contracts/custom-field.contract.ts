import { discoverInstalledModules, scanModuleManifests } from './manifest.contract.js';

export const CUSTOM_FIELD_DATA_TYPE = {
  TEXT: 'TEXT',
  NUMBER: 'NUMBER',
  DATE: 'DATE',
  BOOLEAN: 'BOOLEAN',
  SELECT: 'SELECT',
} as const;

export type CustomFieldDataType =
  (typeof CUSTOM_FIELD_DATA_TYPE)[keyof typeof CUSTOM_FIELD_DATA_TYPE];

export const CUSTOM_FIELD_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
} as const;

export type CustomFieldStatusCode = (typeof CUSTOM_FIELD_STATUS)[keyof typeof CUSTOM_FIELD_STATUS];

export type CustomFieldHistoryActionType =
  | 'CREATED'
  | 'UPDATED'
  | 'OPTIONS_UPDATED'
  | 'STATUS_CHANGED'
  | 'DATA_TYPE_CHANGE_BLOCKED';

/**
 * 9.8.1 — Khai báo loại đối tượng được phép mở rộng (`extensibleEntities`) trong `module.manifest.json`.
 * Chỉ những đối tượng thuộc module đã kích hoạt và có `allowDynamicFields !== false` mới được tạo/lưu Custom Field.
 */
export interface ExtensibleEntityManifestItem {
  readonly code: string;
  readonly module?: string | undefined;
  readonly entityType: string;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly primaryKeyField?: string | undefined;
  readonly readPermission?: string | undefined;
  readonly writePermission?: string | undefined;
  readonly maxCustomFields?: number | undefined;
  readonly allowDynamicFields?: boolean | undefined;
  readonly isSystem?: boolean | undefined;
  readonly status?: number | undefined;
}

export interface RegisteredExtensibleEntity {
  readonly code: string;
  readonly module: string;
  readonly entityType: string;
  readonly name: string;
  readonly description: string | null;
  readonly primaryKeyField: string;
  readonly readPermission: string;
  readonly writePermission: string;
  readonly maxCustomFields: number;
  readonly allowDynamicFields: boolean;
  readonly isSystem: boolean;
  readonly status: number;
  readonly registeredAt: string;
}

/**
 * 9.8.5 — Danh sách lựa chọn (`options`) cho trường kiểu `SELECT` (có thứ tự `sortOrder` và trạng thái `status`).
 */
export interface CustomFieldOptionItem {
  readonly optionCode: string;
  readonly label: string;
  readonly labels?: Readonly<Record<string, string>> | undefined;
  readonly color?: string | null | undefined;
  readonly sortOrder: number;
  readonly isDefault?: boolean | undefined;
  readonly status: CustomFieldStatusCode;
}

/**
 * 9.8.3 — Quy tắc kiểm tra dữ liệu (`validationRules`) khi lưu giá trị trường tùy chỉnh.
 */
export interface CustomFieldValidationRules {
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
  readonly pattern?: string | undefined;
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly integerOnly?: boolean | undefined;
  readonly minDate?: string | undefined;
  readonly maxDate?: string | undefined;
}

/**
 * 9.8.2 — Khai báo sẵn trường tùy chỉnh trong `module.manifest.json` (`customFields`).
 */
export interface CustomFieldManifestItem {
  readonly entityCode: string;
  readonly fieldKey: string;
  readonly module?: string | undefined;
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
}

/**
 * Bản ghi định nghĩa trường tùy chỉnh đã đăng ký trong `CustomFieldRegistryService` & DB.
 */
export interface CustomFieldDefinitionRecord {
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
  readonly version: number;
  readonly createdBy: number | null;
  readonly updatedBy: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Giá trị của một trường tùy chỉnh gắn với bản ghi đối tượng (`entityCode` + `recordId`).
 */
export interface CustomFieldValueRecord {
  readonly id: number;
  readonly fieldId: number;
  readonly entityCode: string;
  readonly fieldKey: string;
  readonly recordId: string;
  readonly dataType: CustomFieldDataType;
  readonly value: unknown;
  readonly textValue: string | null;
  readonly numberValue: number | null;
  readonly dateValue: string | null;
  readonly booleanValue: boolean | null;
  readonly optionCode: string | null;
  readonly optionLabel?: string | null | undefined;
  readonly isEncrypted: boolean;
  readonly updatedBy: number | null;
  readonly updatedAt: string;
}

/**
 * 9.8.8 — Bản ghi lịch sử thay đổi cấu hình trường tùy chỉnh.
 */
export interface CustomFieldHistoryRecord {
  readonly id: number;
  readonly fieldId: number;
  readonly entityCode: string;
  readonly fieldKey: string;
  readonly actionType: CustomFieldHistoryActionType;
  readonly changedFields: readonly string[];
  readonly beforeSnapshot: Readonly<Record<string, unknown>> | null;
  readonly afterSnapshot: Readonly<Record<string, unknown>> | null;
  readonly reason: string | null;
  readonly actorUserId: number | null;
  readonly createdAt: string;
}

/**
 * Ngữ cảnh người dùng thực hiện đọc/sửa trường tùy chỉnh (9.8.4).
 */
export interface CustomFieldActorContext {
  readonly id?: number | null | undefined;
  readonly roles?: readonly string[] | undefined;
  readonly permissions?: readonly string[] | undefined;
  readonly bypassPermissionCheck?: boolean | undefined;
}

/**
 * 9.8.7 — Điều kiện lọc theo trường tùy chỉnh (chỉ cho phép lọc các trường có `isIndexed: true`).
 */
export type CustomFieldFilterOperator =
  | 'eq'
  | 'ne'
  | 'contains'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in';

export interface CustomFieldFilterCondition {
  readonly fieldKey: string;
  readonly operator?: CustomFieldFilterOperator | undefined;
  readonly value: unknown;
}

/**
 * 9.8.1 — Quét toàn bộ `module.manifest.json` của các module đã kích hoạt để thu thập `extensibleEntities`.
 */
export function discoverManifestExtensibleEntities(): ExtensibleEntityManifestItem[] {
  const installedModules = new Set(discoverInstalledModules().map((mod) => mod.toLowerCase()));
  const discovered: ExtensibleEntityManifestItem[] = [];

  for (const entry of scanModuleManifests<{
    name?: string;
    extensibleEntities?: ExtensibleEntityManifestItem[];
  }>()) {
    if (!installedModules.has(entry.moduleName)) continue;
    const items = entry.raw.extensibleEntities;
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      if (!item || typeof item.code !== 'string' || item.code.trim().length === 0) continue;
      discovered.push({
        ...item,
        code: item.code.trim().toLowerCase(),
        module: (item.module ?? entry.moduleName).trim().toLowerCase(),
      });
    }
  }

  return discovered;
}

/**
 * 9.8.2 — Quét toàn bộ `module.manifest.json` của các module đã kích hoạt để thu thập `customFields` mặc định.
 */
export function discoverManifestCustomFields(): CustomFieldManifestItem[] {
  const installedModules = new Set(discoverInstalledModules().map((mod) => mod.toLowerCase()));
  const discovered: CustomFieldManifestItem[] = [];

  for (const entry of scanModuleManifests<{
    name?: string;
    customFields?: CustomFieldManifestItem[];
  }>()) {
    if (!installedModules.has(entry.moduleName)) continue;
    const items = entry.raw.customFields;
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      if (
        !item ||
        typeof item.entityCode !== 'string' ||
        item.entityCode.trim().length === 0 ||
        typeof item.fieldKey !== 'string' ||
        item.fieldKey.trim().length === 0
      ) {
        continue;
      }
      discovered.push({
        ...item,
        entityCode: item.entityCode.trim().toLowerCase(),
        fieldKey: item.fieldKey.trim(),
        module: (item.module ?? entry.moduleName).trim().toLowerCase(),
      });
    }
  }

  return discovered;
}

/**
 * 9.8.7 — Parse tham số lọc trường tùy chỉnh (`customFieldFilters`) từ query string (JSON array, JSON object hoặc chuỗi `fieldKey:value,fieldKey2:value2`).
 */
export function parseCustomFieldFiltersParam(
  raw?: string | readonly CustomFieldFilterCondition[] | Record<string, unknown> | null,
): CustomFieldFilterCondition[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter(
      (item): item is CustomFieldFilterCondition =>
        Boolean(item && typeof item === 'object' && typeof item.fieldKey === 'string' && item.fieldKey.trim().length > 0),
    );
  }
  if (typeof raw === 'object') {
    return Object.entries(raw)
      .filter(([k, v]) => k.trim().length > 0 && v !== undefined)
      .map(([k, v]) => ({ fieldKey: k.trim(), operator: 'eq' as const, value: v }));
  }
  const trimmed = String(raw).trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter(
            (item): item is Record<string, unknown> =>
              Boolean(item && typeof item === 'object' && typeof (item as Record<string, unknown>).fieldKey === 'string'),
          )
          .map((item) => ({
            fieldKey: String(item.fieldKey).trim(),
            operator: (typeof item.operator === 'string'
              ? item.operator
              : 'eq') as CustomFieldFilterOperator,
            value: item.value,
          }));
      }
      if (parsed && typeof parsed === 'object') {
        return Object.entries(parsed as Record<string, unknown>)
          .filter(([k, v]) => k.trim().length > 0 && v !== undefined)
          .map(([k, v]) => ({ fieldKey: k.trim(), operator: 'eq' as const, value: v }));
      }
    } catch {
      // Fallback to key:value parsing below
    }
  }

  return trimmed
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.includes(':'))
    .map((part) => {
      const idx = part.indexOf(':');
      const fieldKey = part.slice(0, idx).trim();
      const value = part.slice(idx + 1).trim();
      return { fieldKey, operator: 'eq' as const, value };
    })
    .filter((item) => item.fieldKey.length > 0);
}


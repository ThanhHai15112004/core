import {
  HTTP_ERROR_CODE,
  VALIDATION_ISSUE_CODE,
  ValidationAppException,
} from '../errors/http-exceptions.js';
import { safeJsonParse } from '../utils/json.util.js';
import { scanModuleManifests } from './manifest.contract.js';

/**
 * Mã số nguyên kiểu giá trị cấu hình (Mục 5.1.3 — Hỗ trợ kiểu Text, Number, Boolean và JSON):
 * - 1 = TEXT (Chuỗi văn bản)
 * - 2 = NUMBER (Số nguyên / Số thực)
 * - 3 = BOOLEAN (Luận lý true / false)
 * - 4 = JSON (Cấu trúc Object hoặc Array JSON)
 */
export const SETTING_VALUE_TYPE = {
  TEXT: 1,
  NUMBER: 2,
  BOOLEAN: 3,
  JSON: 4,
} as const;

export type SettingValueTypeCode = (typeof SETTING_VALUE_TYPE)[keyof typeof SETTING_VALUE_TYPE];
export type SettingValueTypeName = keyof typeof SETTING_VALUE_TYPE;

export const SETTING_ITEM_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
} as const;

export type SettingItemStatusCode = (typeof SETTING_ITEM_STATUS)[keyof typeof SETTING_ITEM_STATUS];

/**
 * Mã số nguyên môi trường cấu hình (Mục 5.1.4):
 * - 1 = ALL (Toàn bộ môi trường)
 * - 2 = DEVELOPMENT (Môi trường phát triển)
 * - 3 = STAGING (Môi trường kiểm thử tích hợp / UAT)
 * - 4 = PRODUCTION (Môi trường vận hành thực tế)
 * - 5 = TEST (Môi trường kiểm thử tự động)
 */
export const SETTING_ENVIRONMENT = {
  ALL: 1,
  DEVELOPMENT: 2,
  STAGING: 3,
  PRODUCTION: 4,
  TEST: 5,
} as const;

export type SettingEnvironmentCode = (typeof SETTING_ENVIRONMENT)[keyof typeof SETTING_ENVIRONMENT];
export type SettingEnvironmentName = 'ALL' | 'development' | 'staging' | 'production' | 'test';

export const SENSITIVE_SETTING_MASK = '••••••••';

/** Mã nhóm cấu hình hệ thống (được khai báo động từ module.manifest.json hoặc Seeder, không hardcode trong Kernel) */
export type SystemSettingGroupCode = string;

/** Nguồn phân giải giá trị cấu hình hiệu lực (Mục 5.1.4 & 5.1.5) */
export type SettingResolvedSource = 'UNIT_ENV' | 'UNIT_ALL' | 'GLOBAL_ENV' | 'GLOBAL' | 'DEFAULT';

/** Quy tắc kiểm tra dữ liệu bổ sung cho cấu hình trước khi lưu (Mục 5.1.3) */
export interface SettingValidationRules {
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  readonly integerOnly?: boolean | undefined;
  readonly minLength?: number | undefined;
  readonly maxLength?: number | undefined;
  readonly pattern?: string | undefined;
  readonly enumOptions?: readonly (string | number)[] | undefined;
  readonly allowEmpty?: boolean | undefined;
}

/** Khai báo nhóm cấu hình hệ thống trong `module.manifest.json` (Mục 5.1.1) */
export interface SettingGroupManifestItem {
  readonly code: string;
  readonly module?: string | undefined;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly icon?: string | null | undefined;
  readonly sortOrder?: number | undefined;
  readonly isSystem?: boolean | undefined;
  readonly status?: number | undefined;
}

/** Khai báo định nghĩa cấu hình trong `module.manifest.json` (Mục 5.1.1 -> 5.1.6) */
export interface SettingManifestItem {
  readonly key: string;
  readonly groupCode: string;
  readonly module?: string | undefined;
  readonly namespace?: string | undefined;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly valueType: SettingValueTypeCode | SettingValueTypeName | string;
  readonly defaultValue: unknown;
  readonly validationRules?: SettingValidationRules | null | undefined;
  readonly isSensitive?: boolean | undefined;
  readonly allowUnitOverride?: boolean | undefined;
  readonly isSystem?: boolean | undefined;
  readonly sortOrder?: number | undefined;
  readonly status?: number | undefined;
  readonly environmentOverrides?: Readonly<Record<string, unknown>> | null | undefined;
}

export interface RegisteredSettingGroup {
  id: number;
  code: string;
  module: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  isSystem: boolean;
  status: SettingItemStatusCode;
}

export interface RegisteredSettingScopeOverride {
  id?: number | undefined;
  settingId: number;
  settingKey: string;
  environmentCode: SettingEnvironmentCode;
  environment: string;
  organizationUnitId: number | null;
  scopeKey: string;
  serializedValue: string;
  isEncrypted: boolean;
  updatedBy: number | null;
  reason: string | null;
  updatedAt?: string | undefined;
}

export interface RegisteredSettingDefinition {
  id: number;
  groupId: number;
  key: string;
  groupCode: string;
  module: string;
  namespace: string;
  name: string;
  description: string | null;
  valueType: SettingValueTypeCode;
  valueTypeName: SettingValueTypeName;
  defaultSerializedValue: string;
  globalSerializedValue: string;
  validationRules: SettingValidationRules | null;
  isSensitive: boolean;
  isEncrypted: boolean;
  allowUnitOverride: boolean;
  isSystem: boolean;
  sortOrder: number;
  status: SettingItemStatusCode;
  updatedBy: number | null;
}

export interface SettingResolveContext {
  readonly environment?: string | number | null | undefined;
  readonly organizationUnitId?: number | null | undefined;
}

export interface ResolvedSettingView<T = unknown> {
  readonly id?: number | undefined;
  readonly groupId?: number | undefined;
  readonly key: string;
  readonly groupCode: string;
  readonly module: string;
  readonly namespace: string;
  readonly name: string;
  readonly description: string | null;
  readonly valueType: SettingValueTypeCode;
  readonly valueTypeName: SettingValueTypeName;
  readonly value: T;
  readonly defaultValue: unknown;
  readonly isSensitive: boolean;
  readonly isEncrypted: boolean;
  readonly hasValue: boolean;
  readonly allowUnitOverride: boolean;
  readonly isSystem: boolean;
  readonly resolvedSource: SettingResolvedSource;
  readonly resolvedEnvironment: string;
  readonly resolvedOrganizationUnitId: number | null;
  readonly fromCache: boolean;
}

/** Chuyển đổi mã số nguyên kiểu cấu hình sang tên chuẩn */
export function getSettingValueTypeName(code: number): SettingValueTypeName {
  switch (Number(code)) {
    case SETTING_VALUE_TYPE.NUMBER:
      return 'NUMBER';
    case SETTING_VALUE_TYPE.BOOLEAN:
      return 'BOOLEAN';
    case SETTING_VALUE_TYPE.JSON:
      return 'JSON';
    case SETTING_VALUE_TYPE.TEXT:
    default:
      return 'TEXT';
  }
}

/** Chuẩn hóa đầu vào kiểu dữ liệu cấu hình (số hoặc chuỗi) về mã `SettingValueTypeCode` */
export function parseSettingValueTypeCode(input: unknown): SettingValueTypeCode {
  if (typeof input === 'number' && Number.isInteger(input)) {
    if (
      input === SETTING_VALUE_TYPE.TEXT ||
      input === SETTING_VALUE_TYPE.NUMBER ||
      input === SETTING_VALUE_TYPE.BOOLEAN ||
      input === SETTING_VALUE_TYPE.JSON
    ) {
      return input;
    }
  }
  const normalized = String(input ?? '')
    .trim()
    .toUpperCase();
  switch (normalized) {
    case '2':
    case 'NUMBER':
    case 'INT':
    case 'INTEGER':
    case 'FLOAT':
    case 'DECIMAL':
      return SETTING_VALUE_TYPE.NUMBER;
    case '3':
    case 'BOOLEAN':
    case 'BOOL':
      return SETTING_VALUE_TYPE.BOOLEAN;
    case '4':
    case 'JSON':
    case 'OBJECT':
    case 'ARRAY':
      return SETTING_VALUE_TYPE.JSON;
    case '1':
    case 'TEXT':
    case 'STRING':
      return SETTING_VALUE_TYPE.TEXT;
    default:
      throw new ValidationAppException(
        [
          {
            field: 'valueType',
            message: `Unsupported setting valueType '${String(input)}'. Allowed types: TEXT (1), NUMBER (2), BOOLEAN (3), JSON (4)`,
            code: VALIDATION_ISSUE_CODE.INVALID_VALUE,
          },
        ],
        HTTP_ERROR_CODE.VALIDATION_FAILED,
      );
  }
}

/** Chuyển đổi mã số nguyên môi trường (`1..5`) sang tên chuẩn (`ALL`, `development`, `staging`, `production`, `test`) */
export function getSettingEnvironmentName(code: number): SettingEnvironmentName {
  switch (Number(code)) {
    case SETTING_ENVIRONMENT.DEVELOPMENT:
      return 'development';
    case SETTING_ENVIRONMENT.STAGING:
      return 'staging';
    case SETTING_ENVIRONMENT.PRODUCTION:
      return 'production';
    case SETTING_ENVIRONMENT.TEST:
      return 'test';
    case SETTING_ENVIRONMENT.ALL:
    default:
      return 'ALL';
  }
}

/** Chuẩn hóa đầu vào môi trường về mã số nguyên `SettingEnvironmentCode` */
export function parseSettingEnvironmentCode(
  input?: string | number | null,
): SettingEnvironmentCode {
  if (typeof input === 'number' && Number.isInteger(input)) {
    switch (input) {
      case SETTING_ENVIRONMENT.DEVELOPMENT:
        return SETTING_ENVIRONMENT.DEVELOPMENT;
      case SETTING_ENVIRONMENT.STAGING:
        return SETTING_ENVIRONMENT.STAGING;
      case SETTING_ENVIRONMENT.PRODUCTION:
        return SETTING_ENVIRONMENT.PRODUCTION;
      case SETTING_ENVIRONMENT.TEST:
        return SETTING_ENVIRONMENT.TEST;
      case SETTING_ENVIRONMENT.ALL:
      default:
        return SETTING_ENVIRONMENT.ALL;
    }
  }
  const normalized = String(input ?? '')
    .trim()
    .toLowerCase();
  switch (normalized) {
    case '2':
    case 'development':
    case 'dev':
    case 'local':
      return SETTING_ENVIRONMENT.DEVELOPMENT;
    case '3':
    case 'staging':
    case 'stage':
    case 'uat':
      return SETTING_ENVIRONMENT.STAGING;
    case '4':
    case 'production':
    case 'prod':
      return SETTING_ENVIRONMENT.PRODUCTION;
    case '5':
    case 'test':
    case 'testing':
      return SETTING_ENVIRONMENT.TEST;
    case '1':
    case 'all':
    case '*':
    case '':
    default:
      return SETTING_ENVIRONMENT.ALL;
  }
}

/** Chuẩn hóa mã môi trường (`ALL`, `development`, `staging`, `production`, `test`) */
export function normalizeSettingEnvironment(env?: string | number | null): SettingEnvironmentName {
  return getSettingEnvironmentName(parseSettingEnvironmentCode(env));
}

/** Tạo khóa định danh duy nhất cho phạm vi cấu hình `<key>:<env>:<unitId|GLOBAL>` */
export function buildSettingScopeKey(
  settingKey: string,
  environment?: string | number | null,
  organizationUnitId?: number | null,
): string {
  const normKey = settingKey.trim().toLowerCase();
  const normEnv = normalizeSettingEnvironment(environment);
  const unitPart =
    organizationUnitId !== undefined &&
    organizationUnitId !== null &&
    Number.isInteger(Number(organizationUnitId)) &&
    Number(organizationUnitId) > 0
      ? `UNIT_${Number(organizationUnitId)}`
      : 'GLOBAL';
  return `${normKey}:${normEnv}:${unitPart}`;
}

function throwSettingValidationError(
  settingKey: string,
  message: string,
  code: (typeof VALIDATION_ISSUE_CODE)[keyof typeof VALIDATION_ISSUE_CODE],
): never {
  throw new ValidationAppException(
    [{ field: settingKey, message, code }],
    HTTP_ERROR_CODE.VALIDATION_FAILED,
  );
}

function validateTextSettingValue(
  rawInput: unknown,
  rules: SettingValidationRules | null | undefined,
  settingKey: string,
): { serialized: string; parsedValue: string } {
  if (typeof rawInput !== 'string') {
    throwSettingValidationError(
      settingKey,
      `Setting '${settingKey}' requires a TEXT (string) value`,
      VALIDATION_ISSUE_CODE.INVALID_TYPE,
    );
  }
  if (rules?.allowEmpty === false && rawInput.trim().length === 0) {
    throwSettingValidationError(
      settingKey,
      `Setting '${settingKey}' cannot be empty`,
      VALIDATION_ISSUE_CODE.INVALID_VALUE,
    );
  }
  if (rules?.minLength !== undefined && rawInput.length < rules.minLength) {
    throwSettingValidationError(
      settingKey,
      `Setting '${settingKey}' must be at least ${rules.minLength} characters`,
      VALIDATION_ISSUE_CODE.TOO_SMALL,
    );
  }
  if (rules?.maxLength !== undefined && rawInput.length > rules.maxLength) {
    throwSettingValidationError(
      settingKey,
      `Setting '${settingKey}' must not exceed ${rules.maxLength} characters`,
      VALIDATION_ISSUE_CODE.TOO_BIG,
    );
  }
  if (rules?.pattern && !new RegExp(rules.pattern).test(rawInput)) {
    throwSettingValidationError(
      settingKey,
      `Setting '${settingKey}' does not match required pattern`,
      VALIDATION_ISSUE_CODE.INVALID_FORMAT,
    );
  }
  if (rules?.enumOptions && rules.enumOptions.length > 0) {
    const allowed = rules.enumOptions.map(String);
    if (!allowed.includes(rawInput)) {
      throwSettingValidationError(
        settingKey,
        `Setting '${settingKey}' must be one of: ${allowed.join(', ')}`,
        VALIDATION_ISSUE_CODE.INVALID_VALUE,
      );
    }
  }
  return { serialized: rawInput, parsedValue: rawInput };
}

function validateNumberSettingValue(
  rawInput: unknown,
  rules: SettingValidationRules | null | undefined,
  settingKey: string,
): { serialized: string; parsedValue: number } {
  const numVal =
    typeof rawInput === 'number'
      ? rawInput
      : typeof rawInput === 'string' && rawInput.trim().length > 0
        ? Number(rawInput.trim())
        : Number.NaN;

  if (!Number.isFinite(numVal)) {
    throwSettingValidationError(
      settingKey,
      `Setting '${settingKey}' requires a valid NUMBER value`,
      VALIDATION_ISSUE_CODE.INVALID_TYPE,
    );
  }
  if (rules?.integerOnly && !Number.isInteger(numVal)) {
    throwSettingValidationError(
      settingKey,
      `Setting '${settingKey}' must be an integer number`,
      VALIDATION_ISSUE_CODE.INVALID_TYPE,
    );
  }
  if (rules?.min !== undefined && numVal < rules.min) {
    throwSettingValidationError(
      settingKey,
      `Setting '${settingKey}' must be greater than or equal to ${rules.min}`,
      VALIDATION_ISSUE_CODE.TOO_SMALL,
    );
  }
  if (rules?.max !== undefined && numVal > rules.max) {
    throwSettingValidationError(
      settingKey,
      `Setting '${settingKey}' must be less than or equal to ${rules.max}`,
      VALIDATION_ISSUE_CODE.TOO_BIG,
    );
  }
  if (rules?.enumOptions && rules.enumOptions.length > 0) {
    const allowedNums = rules.enumOptions.map(Number);
    if (!allowedNums.includes(numVal)) {
      throwSettingValidationError(
        settingKey,
        `Setting '${settingKey}' must be one of: ${allowedNums.join(', ')}`,
        VALIDATION_ISSUE_CODE.INVALID_VALUE,
      );
    }
  }
  return { serialized: String(numVal), parsedValue: numVal };
}

function validateBooleanSettingValue(
  rawInput: unknown,
  settingKey: string,
): { serialized: string; parsedValue: boolean } {
  let boolVal: boolean | null = null;
  if (typeof rawInput === 'boolean') {
    boolVal = rawInput;
  } else if (typeof rawInput === 'string') {
    const norm = rawInput.trim().toLowerCase();
    if (norm === 'true' || norm === '1') boolVal = true;
    else if (norm === 'false' || norm === '0') boolVal = false;
  } else if (rawInput === 1) {
    boolVal = true;
  } else if (rawInput === 0) {
    boolVal = false;
  }

  if (boolVal === null) {
    throwSettingValidationError(
      settingKey,
      `Setting '${settingKey}' requires a valid BOOLEAN (true/false) value`,
      VALIDATION_ISSUE_CODE.INVALID_TYPE,
    );
  }
  return { serialized: boolVal ? 'true' : 'false', parsedValue: boolVal };
}

function validateJsonSettingValue(
  rawInput: unknown,
  settingKey: string,
): { serialized: string; parsedValue: unknown } {
  let parsedJson: unknown;
  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      throwSettingValidationError(
        settingKey,
        `Setting '${settingKey}' requires a valid JSON object or array`,
        VALIDATION_ISSUE_CODE.INVALID_TYPE,
      );
    }
    try {
      parsedJson = JSON.parse(trimmed);
    } catch {
      throwSettingValidationError(
        settingKey,
        `Setting '${settingKey}' contains invalid JSON syntax`,
        VALIDATION_ISSUE_CODE.INVALID_FORMAT,
      );
    }
  } else if (typeof rawInput === 'object' && !(rawInput instanceof Date)) {
    parsedJson = rawInput;
  } else {
    throwSettingValidationError(
      settingKey,
      `Setting '${settingKey}' requires a valid JSON object or array`,
      VALIDATION_ISSUE_CODE.INVALID_TYPE,
    );
  }

  if (parsedJson === null || typeof parsedJson !== 'object') {
    throwSettingValidationError(
      settingKey,
      `Setting '${settingKey}' must be a JSON object or array`,
      VALIDATION_ISSUE_CODE.INVALID_TYPE,
    );
  }

  return {
    serialized: JSON.stringify(parsedJson),
    parsedValue: parsedJson,
  };
}

/**
 * Kiểm tra chặt chẽ giá trị đầu vào theo `valueType` (`TEXT`, `NUMBER`, `BOOLEAN`, `JSON`)
 * và bộ quy tắc `validationRules` trước khi lưu xuống Database (Mục 5.1.3).
 */
export function validateAndSerializeSettingValue(
  rawInput: unknown,
  valueTypeInput: SettingValueTypeCode | SettingValueTypeName | string,
  rules?: SettingValidationRules | null,
  settingKey = 'value',
): { serialized: string; parsedValue: unknown } {
  const valueType = parseSettingValueTypeCode(valueTypeInput);

  if (rawInput === undefined || rawInput === null) {
    throwSettingValidationError(
      settingKey,
      `Setting '${settingKey}' value cannot be null or undefined`,
      VALIDATION_ISSUE_CODE.REQUIRED,
    );
  }

  switch (valueType) {
    case SETTING_VALUE_TYPE.TEXT:
      return validateTextSettingValue(rawInput, rules, settingKey);
    case SETTING_VALUE_TYPE.NUMBER:
      return validateNumberSettingValue(rawInput, rules, settingKey);
    case SETTING_VALUE_TYPE.BOOLEAN:
      return validateBooleanSettingValue(rawInput, settingKey);
    case SETTING_VALUE_TYPE.JSON:
    default:
      return validateJsonSettingValue(rawInput, settingKey);
  }
}

/** Giải tuần tự hóa chuỗi lưu trong DB sang đúng kiểu dữ liệu runtime (`string`, `number`, `boolean`, `object/array`) */
export function deserializeSettingValue(
  serialized: string | null | undefined,
  valueTypeInput: SettingValueTypeCode | SettingValueTypeName | string,
): unknown {
  const valueType = parseSettingValueTypeCode(valueTypeInput);
  const raw = serialized ?? '';

  if (valueType === SETTING_VALUE_TYPE.NUMBER) {
    const num = Number(raw);
    return Number.isFinite(num) ? num : 0;
  }

  if (valueType === SETTING_VALUE_TYPE.BOOLEAN) {
    const norm = raw.trim().toLowerCase();
    return norm === 'true' || norm === '1';
  }

  if (valueType === SETTING_VALUE_TYPE.JSON) {
    if (!raw.trim()) return {};
    return safeJsonParse(raw, {});
  }

  return raw;
}

/**
 * Quét tự động (Zero-Hardcode) các tệp `module.manifest.json` trong `modules/*` và `project-modules/*`
 * để thu thập danh mục `settingGroups` và `settings` phục vụ Seeder và L1 Fallback.
 */
export function discoverManifestSettings(): {
  groups: SettingGroupManifestItem[];
  settings: SettingManifestItem[];
} {
  const groupMap = new Map<string, SettingGroupManifestItem>();
  const settingMap = new Map<string, SettingManifestItem>();

  for (const { moduleName, raw } of scanModuleManifests<{
    name?: string;
    settingGroups?: SettingGroupManifestItem[];
    settings?: SettingManifestItem[];
  }>()) {
    if (Array.isArray(raw.settingGroups)) {
      for (const grp of raw.settingGroups) {
        if (!grp || typeof grp.code !== 'string') continue;
        const code = grp.code.trim().toLowerCase();
        if (!groupMap.has(code)) {
          groupMap.set(code, {
            ...grp,
            code,
            module: (grp.module ?? moduleName).trim().toLowerCase(),
          });
        }
      }
    }

    if (Array.isArray(raw.settings)) {
      for (const item of raw.settings) {
        if (!item || typeof item.key !== 'string') continue;
        const key = item.key.trim().toLowerCase();
        if (!settingMap.has(key)) {
          const parts = key.split('.');
          const defaultNamespace = parts.length >= 2 ? `${moduleName}.${parts[0]}` : moduleName;
          settingMap.set(key, {
            ...item,
            key,
            groupCode: (item.groupCode || parts[0] || 'system').trim().toLowerCase(),
            module: (item.module ?? moduleName).trim().toLowerCase(),
            namespace: (item.namespace ?? defaultNamespace).trim().toLowerCase(),
          });
        }
      }
    }
  }

  return {
    groups: [...groupMap.values()],
    settings: [...settingMap.values()],
  };
}

export type SettingChangeListener = (event: {
  key: string;
  module: string;
  namespace: string;
  environment: string;
  organizationUnitId: number | null;
  value: unknown;
}) => void | Promise<void>;

import { Injectable } from '@nestjs/common';
import {
  HTTP_ERROR_CODE,
  VALIDATION_ISSUE_CODE,
  ValidationAppException,
} from '../errors/http-exceptions.js';
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

/** Chuẩn hóa đầu vào môi trường (số `1..5` hoặc chuỗi `ALL`/`development`/`staging`/`production`/`test`) về mã số nguyên `SettingEnvironmentCode` */
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
    throw new ValidationAppException(
      [
        {
          field: settingKey,
          message: `Setting '${settingKey}' value cannot be null or undefined`,
          code: VALIDATION_ISSUE_CODE.REQUIRED,
        },
      ],
      HTTP_ERROR_CODE.VALIDATION_FAILED,
    );
  }

  if (valueType === SETTING_VALUE_TYPE.TEXT) {
    if (typeof rawInput !== 'string') {
      throw new ValidationAppException(
        [
          {
            field: settingKey,
            message: `Setting '${settingKey}' requires a TEXT (string) value`,
            code: VALIDATION_ISSUE_CODE.INVALID_TYPE,
          },
        ],
        HTTP_ERROR_CODE.VALIDATION_FAILED,
      );
    }
    const strVal = rawInput;
    if (rules?.allowEmpty === false && strVal.trim().length === 0) {
      throw new ValidationAppException(
        [
          {
            field: settingKey,
            message: `Setting '${settingKey}' cannot be empty`,
            code: VALIDATION_ISSUE_CODE.INVALID_VALUE,
          },
        ],
        HTTP_ERROR_CODE.VALIDATION_FAILED,
      );
    }
    if (rules?.minLength !== undefined && strVal.length < rules.minLength) {
      throw new ValidationAppException(
        [
          {
            field: settingKey,
            message: `Setting '${settingKey}' must be at least ${rules.minLength} characters`,
            code: VALIDATION_ISSUE_CODE.TOO_SMALL,
          },
        ],
        HTTP_ERROR_CODE.VALIDATION_FAILED,
      );
    }
    if (rules?.maxLength !== undefined && strVal.length > rules.maxLength) {
      throw new ValidationAppException(
        [
          {
            field: settingKey,
            message: `Setting '${settingKey}' must not exceed ${rules.maxLength} characters`,
            code: VALIDATION_ISSUE_CODE.TOO_BIG,
          },
        ],
        HTTP_ERROR_CODE.VALIDATION_FAILED,
      );
    }
    if (rules?.pattern) {
      const regex = new RegExp(rules.pattern);
      if (!regex.test(strVal)) {
        throw new ValidationAppException(
          [
            {
              field: settingKey,
              message: `Setting '${settingKey}' does not match required pattern`,
              code: VALIDATION_ISSUE_CODE.INVALID_FORMAT,
            },
          ],
          HTTP_ERROR_CODE.VALIDATION_FAILED,
        );
      }
    }
    if (rules?.enumOptions && rules.enumOptions.length > 0) {
      const allowed = rules.enumOptions.map(String);
      if (!allowed.includes(strVal)) {
        throw new ValidationAppException(
          [
            {
              field: settingKey,
              message: `Setting '${settingKey}' must be one of: ${allowed.join(', ')}`,
              code: VALIDATION_ISSUE_CODE.INVALID_VALUE,
            },
          ],
          HTTP_ERROR_CODE.VALIDATION_FAILED,
        );
      }
    }
    return { serialized: strVal, parsedValue: strVal };
  }

  if (valueType === SETTING_VALUE_TYPE.NUMBER) {
    let numVal: number;
    if (typeof rawInput === 'number') {
      numVal = rawInput;
    } else if (typeof rawInput === 'string' && rawInput.trim().length > 0) {
      numVal = Number(rawInput.trim());
    } else {
      numVal = Number.NaN;
    }

    if (!Number.isFinite(numVal)) {
      throw new ValidationAppException(
        [
          {
            field: settingKey,
            message: `Setting '${settingKey}' requires a valid NUMBER value`,
            code: VALIDATION_ISSUE_CODE.INVALID_TYPE,
          },
        ],
        HTTP_ERROR_CODE.VALIDATION_FAILED,
      );
    }

    if (rules?.integerOnly && !Number.isInteger(numVal)) {
      throw new ValidationAppException(
        [
          {
            field: settingKey,
            message: `Setting '${settingKey}' must be an integer number`,
            code: VALIDATION_ISSUE_CODE.INVALID_TYPE,
          },
        ],
        HTTP_ERROR_CODE.VALIDATION_FAILED,
      );
    }
    if (rules?.min !== undefined && numVal < rules.min) {
      throw new ValidationAppException(
        [
          {
            field: settingKey,
            message: `Setting '${settingKey}' must be greater than or equal to ${rules.min}`,
            code: VALIDATION_ISSUE_CODE.TOO_SMALL,
          },
        ],
        HTTP_ERROR_CODE.VALIDATION_FAILED,
      );
    }
    if (rules?.max !== undefined && numVal > rules.max) {
      throw new ValidationAppException(
        [
          {
            field: settingKey,
            message: `Setting '${settingKey}' must be less than or equal to ${rules.max}`,
            code: VALIDATION_ISSUE_CODE.TOO_BIG,
          },
        ],
        HTTP_ERROR_CODE.VALIDATION_FAILED,
      );
    }
    if (rules?.enumOptions && rules.enumOptions.length > 0) {
      const allowedNums = rules.enumOptions.map(Number);
      if (!allowedNums.includes(numVal)) {
        throw new ValidationAppException(
          [
            {
              field: settingKey,
              message: `Setting '${settingKey}' must be one of: ${allowedNums.join(', ')}`,
              code: VALIDATION_ISSUE_CODE.INVALID_VALUE,
            },
          ],
          HTTP_ERROR_CODE.VALIDATION_FAILED,
        );
      }
    }

    return { serialized: String(numVal), parsedValue: numVal };
  }

  if (valueType === SETTING_VALUE_TYPE.BOOLEAN) {
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
      throw new ValidationAppException(
        [
          {
            field: settingKey,
            message: `Setting '${settingKey}' requires a valid BOOLEAN (true/false) value`,
            code: VALIDATION_ISSUE_CODE.INVALID_TYPE,
          },
        ],
        HTTP_ERROR_CODE.VALIDATION_FAILED,
      );
    }

    return { serialized: boolVal ? 'true' : 'false', parsedValue: boolVal };
  }

  // SETTING_VALUE_TYPE.JSON
  let parsedJson: unknown;
  if (typeof rawInput === 'string') {
    const trimmed = rawInput.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
      throw new ValidationAppException(
        [
          {
            field: settingKey,
            message: `Setting '${settingKey}' requires a valid JSON object or array`,
            code: VALIDATION_ISSUE_CODE.INVALID_TYPE,
          },
        ],
        HTTP_ERROR_CODE.VALIDATION_FAILED,
      );
    }
    try {
      parsedJson = JSON.parse(trimmed);
    } catch {
      throw new ValidationAppException(
        [
          {
            field: settingKey,
            message: `Setting '${settingKey}' contains invalid JSON syntax`,
            code: VALIDATION_ISSUE_CODE.INVALID_FORMAT,
          },
        ],
        HTTP_ERROR_CODE.VALIDATION_FAILED,
      );
    }
  } else if (typeof rawInput === 'object' && !(rawInput instanceof Date)) {
    parsedJson = rawInput;
  } else {
    throw new ValidationAppException(
      [
        {
          field: settingKey,
          message: `Setting '${settingKey}' requires a valid JSON object or array`,
          code: VALIDATION_ISSUE_CODE.INVALID_TYPE,
        },
      ],
      HTTP_ERROR_CODE.VALIDATION_FAILED,
    );
  }

  if (parsedJson === null || typeof parsedJson !== 'object') {
    throw new ValidationAppException(
      [
        {
          field: settingKey,
          message: `Setting '${settingKey}' must be a JSON object or array`,
          code: VALIDATION_ISSUE_CODE.INVALID_TYPE,
        },
      ],
      HTTP_ERROR_CODE.VALIDATION_FAILED,
    );
  }

  return {
    serialized: JSON.stringify(parsedJson),
    parsedValue: parsedJson,
  };
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
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
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

/**
 * L1 In-Memory Registry & Resolver cho Cấu hình Hệ thống (Mục 5.1):
 * Cho phép bất kỳ module nào đọc nhanh giá trị cấu hình theo thứ tự ưu tiên:
 * `Đơn vị + Môi trường` -> `Đơn vị (ALL)` -> `Môi trường (Global)` -> `Toàn cục (Global)` -> `Mặc định (Manifest)`
 */
@Injectable()
export class SettingRegistryService {
  private static sharedInstance: SettingRegistryService | null = null;

  public static getInstance(): SettingRegistryService {
    if (!SettingRegistryService.sharedInstance) {
      SettingRegistryService.sharedInstance = new SettingRegistryService();
    }
    return SettingRegistryService.sharedInstance;
  }

  private readonly groups = new Map<string, RegisteredSettingGroup>();
  private readonly definitions = new Map<string, RegisteredSettingDefinition>();
  private readonly scopeOverrides = new Map<string, RegisteredSettingScopeOverride>();
  private readonly listeners = new Set<SettingChangeListener>();
  private nextGroupId = 1;
  private nextDefinitionId = 1;
  private activeEnvironment = normalizeSettingEnvironment(process.env.NODE_ENV || 'development');

  constructor() {
    this.bootstrapFromManifests();
    if (!SettingRegistryService.sharedInstance) {
      SettingRegistryService.sharedInstance = this;
    }
  }

  /** Nạp danh mục cấu hình mặc định từ các `module.manifest.json` vào L1 Cache */
  public bootstrapFromManifests(): void {
    const discovered = discoverManifestSettings();
    for (const grp of discovered.groups) {
      this.registerGroup(grp);
    }
    for (const item of discovered.settings) {
      this.registerManifestSetting(item);
    }
  }

  /** Đặt môi trường mặc định hiện hành khi phân giải cấu hình */
  public setActiveEnvironment(environment: string | number): void {
    this.activeEnvironment = normalizeSettingEnvironment(environment);
  }

  public getActiveEnvironment(): string {
    return this.activeEnvironment;
  }

  /** Đăng ký listener nhận thông báo mỗi khi một cấu hình thay đổi */
  public onSettingChanged(listener: SettingChangeListener): () => void {
    this.listeners.add(listener);
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      SettingRegistryService.sharedInstance.listeners.add(listener);
    }
    return () => {
      this.listeners.delete(listener);
      if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
        SettingRegistryService.sharedInstance.listeners.delete(listener);
      }
    };
  }

  public async notifySettingChanged(event: {
    key: string;
    module: string;
    namespace: string;
    environment: string;
    organizationUnitId: number | null;
    value: unknown;
  }): Promise<void> {
    const allListeners = new Set<SettingChangeListener>(this.listeners);
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      for (const l of SettingRegistryService.sharedInstance.listeners) {
        allListeners.add(l);
      }
    }
    for (const listener of allListeners) {
      try {
        await listener(event);
      } catch {
        // Ignore listener error to avoid breaking setting update flow
      }
    }
  }

  public registerGroup(
    input: SettingGroupManifestItem & { id?: number | undefined },
  ): RegisteredSettingGroup {
    const code = input.code.trim().toLowerCase();
    const existing = this.groups.get(code);
    const assignedId =
      input.id !== undefined ? Number(input.id) : (existing?.id ?? this.nextGroupId++);
    if (assignedId >= this.nextGroupId) {
      this.nextGroupId = assignedId + 1;
    }
    const group: RegisteredSettingGroup = {
      id: assignedId,
      code,
      module: (input.module ?? existing?.module ?? 'settings').trim().toLowerCase(),
      name: input.name.trim(),
      description: input.description ?? existing?.description ?? null,
      icon: input.icon ?? existing?.icon ?? null,
      sortOrder: input.sortOrder ?? existing?.sortOrder ?? 0,
      isSystem: input.isSystem ?? existing?.isSystem ?? true,
      status:
        input.status === SETTING_ITEM_STATUS.INACTIVE
          ? SETTING_ITEM_STATUS.INACTIVE
          : SETTING_ITEM_STATUS.ACTIVE,
    };
    this.groups.set(code, group);
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      SettingRegistryService.sharedInstance.groups.set(code, group);
    }
    return group;
  }

  public getGroupByCode(code: string): RegisteredSettingGroup | undefined {
    return this.groups.get(code.trim().toLowerCase());
  }

  public getGroupById(id: number): RegisteredSettingGroup | undefined {
    const targetId = Number(id);
    for (const grp of this.groups.values()) {
      if (Number(grp.id) === targetId) {
        return grp;
      }
    }
    return undefined;
  }

  public removeGroup(code: string): boolean {
    const norm = code.trim().toLowerCase();
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      SettingRegistryService.sharedInstance.groups.delete(norm);
    }
    return this.groups.delete(norm);
  }

  public registerManifestSetting(
    item: SettingManifestItem & { id?: number | undefined; groupId?: number | undefined },
  ): RegisteredSettingDefinition {
    const key = item.key.trim().toLowerCase();
    const valueType = parseSettingValueTypeCode(item.valueType);
    const { serialized } = validateAndSerializeSettingValue(
      item.defaultValue,
      valueType,
      item.validationRules,
      key,
    );
    const existing = this.definitions.get(key);
    const parts = key.split('.');
    const moduleName = (item.module ?? existing?.module ?? 'settings').trim().toLowerCase();
    const groupCode = (item.groupCode || existing?.groupCode || parts[0] || 'system')
      .trim()
      .toLowerCase();
    let group = this.groups.get(groupCode);
    if (!group) {
      group = this.registerGroup({
        code: groupCode,
        module: moduleName,
        name: groupCode.toUpperCase(),
      });
    }
    const groupId = item.groupId !== undefined ? Number(item.groupId) : group.id;
    const assignedId =
      item.id !== undefined ? Number(item.id) : (existing?.id ?? this.nextDefinitionId++);
    if (assignedId >= this.nextDefinitionId) {
      this.nextDefinitionId = assignedId + 1;
    }

    const namespace = (
      item.namespace ??
      existing?.namespace ??
      (parts.length >= 2 ? `${moduleName}.${parts[0]}` : moduleName)
    )
      .trim()
      .toLowerCase();

    const registered: RegisteredSettingDefinition = {
      id: assignedId,
      groupId,
      key,
      groupCode,
      module: moduleName,
      namespace,
      name: item.name.trim(),
      description: item.description ?? existing?.description ?? null,
      valueType,
      valueTypeName: getSettingValueTypeName(valueType),
      defaultSerializedValue: serialized,
      globalSerializedValue: existing?.globalSerializedValue ?? serialized,
      validationRules: item.validationRules ?? existing?.validationRules ?? null,
      isSensitive: item.isSensitive ?? existing?.isSensitive ?? false,
      isEncrypted: existing?.isEncrypted ?? false,
      allowUnitOverride: item.allowUnitOverride ?? existing?.allowUnitOverride ?? true,
      isSystem: item.isSystem ?? existing?.isSystem ?? true,
      sortOrder: item.sortOrder ?? existing?.sortOrder ?? 0,
      status:
        item.status === SETTING_ITEM_STATUS.INACTIVE
          ? SETTING_ITEM_STATUS.INACTIVE
          : SETTING_ITEM_STATUS.ACTIVE,
      updatedBy: existing?.updatedBy ?? null,
    };

    this.definitions.set(key, registered);
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      SettingRegistryService.sharedInstance.definitions.set(key, registered);
    }

    if (item.environmentOverrides && typeof item.environmentOverrides === 'object') {
      for (const [envKey, envVal] of Object.entries(item.environmentOverrides)) {
        const envCode = parseSettingEnvironmentCode(envKey);
        const normEnv = getSettingEnvironmentName(envCode);
        const scopeKey = buildSettingScopeKey(key, normEnv, null);
        if (!this.scopeOverrides.has(scopeKey)) {
          const validatedEnv = validateAndSerializeSettingValue(
            envVal,
            valueType,
            item.validationRules,
            key,
          );
          const scopeEntry: RegisteredSettingScopeOverride = {
            settingId: assignedId,
            settingKey: key,
            environmentCode: envCode,
            environment: normEnv,
            organizationUnitId: null,
            scopeKey,
            serializedValue: validatedEnv.serialized,
            isEncrypted: false,
            updatedBy: null,
            reason: 'Manifest environment default',
          };
          this.scopeOverrides.set(scopeKey, scopeEntry);
          if (
            SettingRegistryService.sharedInstance &&
            SettingRegistryService.sharedInstance !== this &&
            !SettingRegistryService.sharedInstance.scopeOverrides.has(scopeKey)
          ) {
            SettingRegistryService.sharedInstance.scopeOverrides.set(scopeKey, scopeEntry);
          }
        }
      }
    }

    return registered;
  }

  public upsertDefinition(def: RegisteredSettingDefinition): void {
    const normKey = def.key.trim().toLowerCase();
    const existing = this.definitions.get(normKey);
    const assignedId =
      def.id !== undefined ? Number(def.id) : (existing?.id ?? this.nextDefinitionId++);
    if (assignedId >= this.nextDefinitionId) {
      this.nextDefinitionId = assignedId + 1;
    }
    const groupById = def.groupId ? this.getGroupById(def.groupId) : undefined;
    const groupByCode = def.groupCode ? this.getGroupByCode(def.groupCode) : undefined;
    const resolvedGroupId = def.groupId ?? groupByCode?.id ?? existing?.groupId ?? 1;
    const resolvedGroupCode = (groupById?.code ?? def.groupCode ?? existing?.groupCode ?? 'system')
      .trim()
      .toLowerCase();

    const normalized: RegisteredSettingDefinition = {
      ...def,
      id: assignedId,
      groupId: resolvedGroupId,
      groupCode: resolvedGroupCode,
      key: normKey,
    };
    this.definitions.set(normKey, normalized);
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      SettingRegistryService.sharedInstance.definitions.set(normKey, normalized);
    }
  }

  public removeDefinition(key: string): boolean {
    const normKey = key.trim().toLowerCase();
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      SettingRegistryService.sharedInstance.definitions.delete(normKey);
    }
    return this.definitions.delete(normKey);
  }

  public upsertScopeOverride(
    override: Omit<RegisteredSettingScopeOverride, 'settingId' | 'environmentCode'> & {
      settingId?: number | undefined;
      environmentCode?: SettingEnvironmentCode | undefined;
    },
  ): void {
    const defById =
      override.settingId !== undefined ? this.getDefinitionById(override.settingId) : undefined;
    const defByKey = override.settingKey ? this.getDefinition(override.settingKey) : undefined;
    const resolvedSettingKey = (defById?.key ?? override.settingKey ?? '').trim().toLowerCase();
    const resolvedSettingId = Number(override.settingId ?? defByKey?.id ?? defById?.id ?? 1);
    const envCode = override.environmentCode ?? parseSettingEnvironmentCode(override.environment);
    const normEnv = getSettingEnvironmentName(envCode);

    const scopeKey = buildSettingScopeKey(resolvedSettingKey, normEnv, override.organizationUnitId);
    const normalized: RegisteredSettingScopeOverride = {
      ...override,
      settingId: resolvedSettingId,
      settingKey: resolvedSettingKey,
      environmentCode: envCode,
      environment: normEnv,
      scopeKey,
    };
    this.scopeOverrides.set(scopeKey, normalized);
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      SettingRegistryService.sharedInstance.scopeOverrides.set(scopeKey, normalized);
    }
  }

  public removeScopeOverride(
    settingKey: string,
    environment?: string | number | null,
    organizationUnitId?: number | null,
  ): boolean {
    const scopeKey = buildSettingScopeKey(settingKey, environment, organizationUnitId);
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      SettingRegistryService.sharedInstance.scopeOverrides.delete(scopeKey);
    }
    return this.scopeOverrides.delete(scopeKey);
  }

  public removeScopeOverrideByScopeKey(scopeKey: string): boolean {
    if (SettingRegistryService.sharedInstance && SettingRegistryService.sharedInstance !== this) {
      SettingRegistryService.sharedInstance.scopeOverrides.delete(scopeKey);
    }
    return this.scopeOverrides.delete(scopeKey);
  }

  public listAllScopeOverrides(): RegisteredSettingScopeOverride[] {
    return [...this.scopeOverrides.values()];
  }

  public getDefinition(key: string): RegisteredSettingDefinition | undefined {
    return this.definitions.get(key.trim().toLowerCase());
  }

  public getDefinitionById(id: number): RegisteredSettingDefinition | undefined {
    const targetId = Number(id);
    for (const def of this.definitions.values()) {
      if (Number(def.id) === targetId) {
        return def;
      }
    }
    return undefined;
  }

  public listDefinitions(): RegisteredSettingDefinition[] {
    return [...this.definitions.values()].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key),
    );
  }

  public listGroups(): RegisteredSettingGroup[] {
    return [...this.groups.values()].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
    );
  }

  public listScopeOverridesForKey(settingKey: string): RegisteredSettingScopeOverride[] {
    const normKey = settingKey.trim().toLowerCase();
    const def = this.definitions.get(normKey);
    const result: RegisteredSettingScopeOverride[] = [];
    for (const item of this.scopeOverrides.values()) {
      if (item.settingKey === normKey || (def && item.settingId === def.id)) {
        result.push(item);
      }
    }
    return result;
  }

  /**
   * Phân giải giá trị cấu hình theo chuỗi ưu tiên:
   * 1. `UNIT_ENV` (Đơn vị + Môi trường cụ thể)
   * 2. `UNIT_ALL` (Đơn vị + Mọi môi trường 'ALL')
   * 3. `GLOBAL_ENV` (Môi trường cụ thể + Toàn hệ thống)
   * 4. `GLOBAL` (Giá trị toàn cục trên `system_settings`)
   * 5. `DEFAULT` (Giá trị mặc định từ Manifest)
   */
  public resolve<T = unknown>(
    key: string,
    context?: SettingResolveContext,
    options?: {
      maskSensitive?: boolean | undefined;
      decryptor?: ((cipherText: string) => string) | undefined;
      fromCache?: boolean | undefined;
    },
  ): ResolvedSettingView<T> | null {
    const normKey = key.trim().toLowerCase();
    const def = this.definitions.get(normKey);
    if (!def) {
      return null;
    }

    const env = normalizeSettingEnvironment(context?.environment ?? this.activeEnvironment);
    const unitId =
      def.allowUnitOverride &&
      context?.organizationUnitId !== undefined &&
      context?.organizationUnitId !== null &&
      Number(context.organizationUnitId) > 0
        ? Number(context.organizationUnitId)
        : null;

    let selectedSerialized = def.globalSerializedValue ?? def.defaultSerializedValue;
    let selectedEncrypted = def.isEncrypted;
    let resolvedSource: SettingResolvedSource =
      def.globalSerializedValue !== undefined &&
      def.globalSerializedValue !== def.defaultSerializedValue
        ? 'GLOBAL'
        : 'GLOBAL';
    let resolvedEnv = 'ALL';
    let resolvedUnitId: number | null = null;

    if (unitId !== null && env !== 'ALL') {
      const unitEnvKey = buildSettingScopeKey(normKey, env, unitId);
      const unitEnvOverride = this.scopeOverrides.get(unitEnvKey);
      if (unitEnvOverride) {
        selectedSerialized = unitEnvOverride.serializedValue;
        selectedEncrypted = unitEnvOverride.isEncrypted;
        resolvedSource = 'UNIT_ENV';
        resolvedEnv = env;
        resolvedUnitId = unitId;
      }
    }

    if (resolvedSource === 'GLOBAL' && unitId !== null) {
      const unitAllKey = buildSettingScopeKey(normKey, 'ALL', unitId);
      const unitAllOverride = this.scopeOverrides.get(unitAllKey);
      if (unitAllOverride) {
        selectedSerialized = unitAllOverride.serializedValue;
        selectedEncrypted = unitAllOverride.isEncrypted;
        resolvedSource = 'UNIT_ALL';
        resolvedEnv = 'ALL';
        resolvedUnitId = unitId;
      }
    }

    if (resolvedSource === 'GLOBAL' && env !== 'ALL') {
      const globalEnvKey = buildSettingScopeKey(normKey, env, null);
      const globalEnvOverride = this.scopeOverrides.get(globalEnvKey);
      if (globalEnvOverride) {
        selectedSerialized = globalEnvOverride.serializedValue;
        selectedEncrypted = globalEnvOverride.isEncrypted;
        resolvedSource = 'GLOBAL_ENV';
        resolvedEnv = env;
        resolvedUnitId = null;
      }
    }

    if (resolvedSource === 'GLOBAL') {
      const globalAllKey = buildSettingScopeKey(normKey, 'ALL', null);
      const globalAllOverride = this.scopeOverrides.get(globalAllKey);
      if (globalAllOverride) {
        selectedSerialized = globalAllOverride.serializedValue;
        selectedEncrypted = globalAllOverride.isEncrypted;
        resolvedSource = 'GLOBAL';
        resolvedEnv = 'ALL';
        resolvedUnitId = null;
      } else if (def.globalSerializedValue === undefined || def.globalSerializedValue === null) {
        selectedSerialized = def.defaultSerializedValue;
        resolvedSource = 'DEFAULT';
      }
    }

    const hasValue =
      selectedSerialized !== undefined && selectedSerialized !== null && selectedSerialized !== '';
    const maskSensitive = options?.maskSensitive !== false;

    let finalValue: unknown;
    if (def.isSensitive && maskSensitive) {
      finalValue = hasValue ? SENSITIVE_SETTING_MASK : '';
    } else {
      let plainSerialized = selectedSerialized;
      if (selectedEncrypted && options?.decryptor) {
        try {
          plainSerialized = options.decryptor(selectedSerialized);
        } catch {
          plainSerialized = selectedSerialized;
        }
      }
      finalValue = deserializeSettingValue(plainSerialized, def.valueType);
    }

    const defaultValue =
      def.isSensitive && maskSensitive
        ? def.defaultSerializedValue
          ? SENSITIVE_SETTING_MASK
          : ''
        : deserializeSettingValue(def.defaultSerializedValue, def.valueType);

    return {
      id: def.id,
      groupId: def.groupId,
      key: def.key,
      groupCode: def.groupCode,
      module: def.module,
      namespace: def.namespace,
      name: def.name,
      description: def.description,
      valueType: def.valueType,
      valueTypeName: def.valueTypeName,
      value: finalValue as T,
      defaultValue,
      isSensitive: def.isSensitive,
      isEncrypted: def.isEncrypted || selectedEncrypted,
      hasValue,
      allowUnitOverride: def.allowUnitOverride,
      isSystem: def.isSystem,
      resolvedSource,
      resolvedEnvironment: resolvedEnv,
      resolvedOrganizationUnitId: resolvedUnitId,
      fromCache: options?.fromCache ?? true,
    };
  }

  /** Cập nhật nhanh giá trị toàn cục (`globalSerializedValue`) của một cấu hình đã đăng ký */
  public setGlobalValue(key: string, value: unknown): void {
    const normKey = key.trim().toLowerCase();
    const def = this.definitions.get(normKey);
    if (!def) return;
    const { serialized } = validateAndSerializeSettingValue(
      value,
      def.valueType,
      def.validationRules,
      normKey,
    );
    this.upsertDefinition({
      ...def,
      globalSerializedValue: serialized,
    });
  }

  /** Đọc nhanh cấu hình kiểu `number` (ví dụ: `getNumber('security.password.min_length', undefined, 8)`) */
  public getNumber(key: string, context?: SettingResolveContext, fallback = 0): number {
    const resolved = this.resolve<number>(key, context, { maskSensitive: false });
    if (!resolved || typeof resolved.value !== 'number' || !Number.isFinite(resolved.value)) {
      return fallback;
    }
    return resolved.value;
  }

  /** Đọc nhanh cấu hình kiểu `boolean` */
  public getBoolean(key: string, context?: SettingResolveContext, fallback = false): boolean {
    const resolved = this.resolve<boolean>(key, context, { maskSensitive: false });
    if (!resolved || typeof resolved.value !== 'boolean') {
      return fallback;
    }
    return resolved.value;
  }

  /** Đọc nhanh cấu hình kiểu `string` */
  public getString(
    key: string,
    context?: SettingResolveContext,
    fallback = '',
    decryptor?: (cipherText: string) => string,
  ): string {
    const resolved = this.resolve<string>(key, context, {
      maskSensitive: false,
      decryptor,
    });
    if (!resolved || typeof resolved.value !== 'string') {
      return fallback;
    }
    return resolved.value;
  }

  /** Đọc nhanh cấu hình kiểu `JSON` */
  public getJson<T = Record<string, unknown>>(
    key: string,
    context?: SettingResolveContext,
    fallback?: T,
  ): T {
    const resolved = this.resolve<T>(key, context, { maskSensitive: false });
    if (!resolved || resolved.value === undefined || resolved.value === null) {
      return (fallback ?? ({} as T)) as T;
    }
    return resolved.value;
  }
}

export const defaultSettingRegistry = new SettingRegistryService();

import { Injectable } from '@nestjs/common';
import { VALIDATION_ISSUE_CODE, ValidationAppException } from '../errors/http-exceptions.js';
import { NotFoundAppException } from '../errors/not-found.exception.js';
import { scanModuleManifests } from './manifest.contract.js';

export const SEQUENCE_DATE_FORMAT = {
  NONE: 0,
  YYYY: 1,
  YY: 2,
  YYYYMM: 3,
  YYMM: 4,
  YYYYMMDD: 5,
  YYMMDD: 6,
} as const;

export type SequenceDateFormatCode =
  (typeof SEQUENCE_DATE_FORMAT)[keyof typeof SEQUENCE_DATE_FORMAT];

export type SequenceDateFormatName = keyof typeof SEQUENCE_DATE_FORMAT;

export const SEQUENCE_DATE_FORMAT_NAME_BY_CODE: Readonly<
  Record<SequenceDateFormatCode, SequenceDateFormatName>
> = {
  [SEQUENCE_DATE_FORMAT.NONE]: 'NONE',
  [SEQUENCE_DATE_FORMAT.YYYY]: 'YYYY',
  [SEQUENCE_DATE_FORMAT.YY]: 'YY',
  [SEQUENCE_DATE_FORMAT.YYYYMM]: 'YYYYMM',
  [SEQUENCE_DATE_FORMAT.YYMM]: 'YYMM',
  [SEQUENCE_DATE_FORMAT.YYYYMMDD]: 'YYYYMMDD',
  [SEQUENCE_DATE_FORMAT.YYMMDD]: 'YYMMDD',
};

export const SEQUENCE_RESET_POLICY = {
  NEVER: 1,
  YEARLY: 2,
  MONTHLY: 3,
  DAILY: 4,
} as const;

export type SequenceResetPolicyCode =
  (typeof SEQUENCE_RESET_POLICY)[keyof typeof SEQUENCE_RESET_POLICY];

export type SequenceResetPolicyName = keyof typeof SEQUENCE_RESET_POLICY;

export const SEQUENCE_RESET_POLICY_NAME_BY_CODE: Readonly<
  Record<SequenceResetPolicyCode, SequenceResetPolicyName>
> = {
  [SEQUENCE_RESET_POLICY.NEVER]: 'NEVER',
  [SEQUENCE_RESET_POLICY.YEARLY]: 'YEARLY',
  [SEQUENCE_RESET_POLICY.MONTHLY]: 'MONTHLY',
  [SEQUENCE_RESET_POLICY.DAILY]: 'DAILY',
};

export const SEQUENCE_STATUS = {
  ACTIVE: 1,
  ARCHIVED: 2,
} as const;

export type SequenceStatusCode = (typeof SEQUENCE_STATUS)[keyof typeof SEQUENCE_STATUS];

/** Khai báo quy tắc sinh mã nghiệp vụ mặc định trong `module.manifest.json` (Mục 5.5) */
export interface SequenceManifestItem {
  readonly key: string;
  readonly module?: string | undefined;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly prefix?: string | undefined;
  readonly suffix?: string | undefined;
  readonly separator?: string | undefined;
  readonly dateFormat?: SequenceDateFormatCode | SequenceDateFormatName | string | undefined;
  readonly templatePattern?: string | null | undefined;
  readonly paddingLength?: number | undefined;
  readonly startValue?: number | undefined;
  readonly step?: number | undefined;
  readonly resetPolicy?: SequenceResetPolicyCode | SequenceResetPolicyName | string | undefined;
  readonly scopeByUnit?: boolean | undefined;
  readonly timezone?: string | undefined;
  readonly isSystem?: boolean | undefined;
  readonly status?: number | undefined;
}

/** Định nghĩa quy tắc sinh mã đã chuẩn hóa trong L1 Registry (Mục 5.5) */
export interface RegisteredSequenceRuleDefinition {
  id?: number | undefined;
  key: string;
  module: string;
  name: string;
  description: string | null;
  prefix: string;
  suffix: string;
  separator: string;
  dateFormat: SequenceDateFormatCode;
  dateFormatName: SequenceDateFormatName;
  templatePattern: string | null;
  paddingLength: number;
  startValue: number;
  step: number;
  resetPolicy: SequenceResetPolicyCode;
  resetPolicyName: SequenceResetPolicyName;
  scopeByUnit: boolean;
  timezone: string;
  isSystem: boolean;
  status: SequenceStatusCode;
  updatedBy?: number | null | undefined;
  updatedAt?: string | undefined;
}

/** Trạng thái bộ đếm theo kỳ & phạm vi đơn vị (Mục 5.5.4 -> 5.5.6) */
export interface SequenceCounterSnapshot {
  readonly sequenceKey: string;
  readonly periodKey: string;
  readonly organizationUnitId: number | null;
  readonly unitScopeKey: string;
  readonly currentValue: number;
  readonly updatedAt: string;
}

/** Ngữ cảnh khi sinh mã hoặc xem trước mẫu mã (Mục 5.5.3 -> 5.5.7) */
export interface SequenceGenerateContext {
  readonly organizationUnitId?: number | string | null | undefined;
  readonly unitCode?: string | null | undefined;
  readonly at?: Date | string | number | null | undefined;
  readonly timezone?: string | null | undefined;
}

/** Kết quả sinh một mã nghiệp vụ (Mục 5.5) */
export interface SequenceGeneratedResult {
  readonly key: string;
  readonly module: string;
  readonly code: string;
  readonly sequenceNumber: number;
  readonly paddedSequence: string;
  readonly periodKey: string;
  readonly unitScopeKey: string;
  readonly organizationUnitId: number | null;
  readonly dateSegment: string;
  readonly generatedAt: string;
}

/** Đầu vào để xem trước mẫu mã trước khi áp dụng (Mục 5.5.7) */
export interface SequencePreviewInput {
  readonly key?: string | undefined;
  readonly prefix?: string | undefined;
  readonly suffix?: string | undefined;
  readonly separator?: string | undefined;
  readonly dateFormat?:
    SequenceDateFormatCode | SequenceDateFormatName | string | number | undefined;
  readonly templatePattern?: string | null | undefined;
  readonly paddingLength?: number | undefined;
  readonly startValue?: number | undefined;
  readonly step?: number | undefined;
  readonly resetPolicy?:
    SequenceResetPolicyCode | SequenceResetPolicyName | string | number | undefined;
  readonly scopeByUnit?: boolean | undefined;
  readonly timezone?: string | undefined;
  readonly sampleSequenceNumber?: number | undefined;
  readonly organizationUnitId?: number | string | null | undefined;
  readonly unitCode?: string | null | undefined;
  readonly at?: Date | string | number | null | undefined;
}

/** Kết quả xem trước mẫu mã trước khi áp dụng (Mục 5.5.7) */
export interface SequencePreviewResult {
  readonly sampleCode: string;
  readonly nextSampleCodes: readonly string[];
  readonly resolvedTemplate: string;
  readonly dateFormat: SequenceDateFormatCode;
  readonly dateFormatName: SequenceDateFormatName;
  readonly resetPolicy: SequenceResetPolicyCode;
  readonly resetPolicyName: SequenceResetPolicyName;
  readonly periodKey: string;
  readonly unitScopeKey: string;
  readonly dateSegment: string;
  readonly paddingLength: number;
  readonly startValue: number;
  readonly step: number;
}

export interface SequenceDateParts {
  readonly yyyy: string;
  readonly yy: string;
  readonly mm: string;
  readonly dd: string;
}

export type SequenceRuleChangeListener = (event: {
  key: string;
  module: string;
}) => void | Promise<void>;

/**
 * Chuẩn hóa `dateFormat` từ số nguyên hoặc tên chuỗi về `SequenceDateFormatCode`.
 */
export function resolveSequenceDateFormatCode(
  input: SequenceDateFormatCode | SequenceDateFormatName | string | number | null | undefined,
): SequenceDateFormatCode {
  if (input === undefined || input === null || input === '') {
    return SEQUENCE_DATE_FORMAT.YYYY;
  }
  if (typeof input === 'number') {
    if (input in SEQUENCE_DATE_FORMAT_NAME_BY_CODE) {
      return input as SequenceDateFormatCode;
    }
  } else if (typeof input === 'string') {
    const trimmed = input.trim().toUpperCase();
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      if (num in SEQUENCE_DATE_FORMAT_NAME_BY_CODE) {
        return num as SequenceDateFormatCode;
      }
    }
    if (trimmed in SEQUENCE_DATE_FORMAT) {
      return SEQUENCE_DATE_FORMAT[trimmed as SequenceDateFormatName];
    }
  }
  throw new ValidationAppException(
    [
      {
        field: 'dateFormat',
        message:
          'Invalid sequence dateFormat. Supported values: NONE (0), YYYY (1), YY (2), YYYYMM (3), YYMM (4), YYYYMMDD (5), YYMMDD (6)',
        code: VALIDATION_ISSUE_CODE.INVALID_VALUE,
      },
    ],
    'Invalid sequence dateFormat',
  );
}

/**
 * Chuẩn hóa `resetPolicy` từ số nguyên hoặc tên chuỗi về `SequenceResetPolicyCode`.
 */
export function resolveSequenceResetPolicyCode(
  input: SequenceResetPolicyCode | SequenceResetPolicyName | string | number | null | undefined,
): SequenceResetPolicyCode {
  if (input === undefined || input === null || input === '') {
    return SEQUENCE_RESET_POLICY.YEARLY;
  }
  if (typeof input === 'number') {
    if (input in SEQUENCE_RESET_POLICY_NAME_BY_CODE) {
      return input as SequenceResetPolicyCode;
    }
  } else if (typeof input === 'string') {
    const trimmed = input.trim().toUpperCase();
    if (/^\d+$/.test(trimmed)) {
      const num = Number(trimmed);
      if (num in SEQUENCE_RESET_POLICY_NAME_BY_CODE) {
        return num as SequenceResetPolicyCode;
      }
    }
    if (trimmed in SEQUENCE_RESET_POLICY) {
      return SEQUENCE_RESET_POLICY[trimmed as SequenceResetPolicyName];
    }
  }
  throw new ValidationAppException(
    [
      {
        field: 'resetPolicy',
        message:
          'Invalid sequence resetPolicy. Supported values: NEVER (1), YEARLY (2), MONTHLY (3), DAILY (4)',
        code: VALIDATION_ISSUE_CODE.INVALID_VALUE,
      },
    ],
    'Invalid sequence resetPolicy',
  );
}

/**
 * Tách thành phần ngày/tháng/năm (`yyyy`, `yy`, `mm`, `dd`) theo múi giờ chuẩn IANA
 * (mặc định `Asia/Ho_Chi_Minh`) phục vụ chèn vào mã và xác định kỳ reset.
 */
export function resolveSequenceDateParts(
  at?: Date | string | number | null,
  timezone = 'Asia/Ho_Chi_Minh',
): SequenceDateParts {
  const dateObj =
    at instanceof Date
      ? at
      : at !== undefined && at !== null && at !== ''
        ? new Date(at)
        : new Date();
  const safeDate = Number.isNaN(dateObj.getTime()) ? new Date() : dateObj;
  const tz = timezone?.trim() || 'Asia/Ho_Chi_Minh';

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(safeDate);
    const yyyy = parts.find((p) => p.type === 'year')?.value ?? String(safeDate.getUTCFullYear());
    const mm =
      parts.find((p) => p.type === 'month')?.value ??
      String(safeDate.getUTCMonth() + 1).padStart(2, '0');
    const dd =
      parts.find((p) => p.type === 'day')?.value ?? String(safeDate.getUTCDate()).padStart(2, '0');
    return {
      yyyy,
      yy: yyyy.slice(-2),
      mm,
      dd,
    };
  } catch {
    const yyyy = String(safeDate.getUTCFullYear());
    const mm = String(safeDate.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(safeDate.getUTCDate()).padStart(2, '0');
    return {
      yyyy,
      yy: yyyy.slice(-2),
      mm,
      dd,
    };
  }
}

/**
 * Định dạng đoạn ngày tháng chèn vào mã theo `SequenceDateFormatCode` (Mục 5.5.3).
 */
export function formatSequenceDateSegment(
  dateFormat: SequenceDateFormatCode,
  parts: SequenceDateParts,
): string {
  switch (dateFormat) {
    case SEQUENCE_DATE_FORMAT.NONE:
      return '';
    case SEQUENCE_DATE_FORMAT.YYYY:
      return parts.yyyy;
    case SEQUENCE_DATE_FORMAT.YY:
      return parts.yy;
    case SEQUENCE_DATE_FORMAT.YYYYMM:
      return `${parts.yyyy}${parts.mm}`;
    case SEQUENCE_DATE_FORMAT.YYMM:
      return `${parts.yy}${parts.mm}`;
    case SEQUENCE_DATE_FORMAT.YYYYMMDD:
      return `${parts.yyyy}${parts.mm}${parts.dd}`;
    case SEQUENCE_DATE_FORMAT.YYMMDD:
      return `${parts.yy}${parts.mm}${parts.dd}`;
    default:
      return parts.yyyy;
  }
}

/**
 * Tính khóa kỳ (`periodKey`) phục vụ tự động reset số thứ tự theo ngày, tháng hoặc năm (Mục 5.5.5).
 * - `NEVER (1)`   -> `'ALL'`
 * - `YEARLY (2)`  -> `'2026'`
 * - `MONTHLY (3)` -> `'2026-10'`
 * - `DAILY (4)`   -> `'2026-10-20'`
 */
export function computeSequencePeriodKey(
  resetPolicy: SequenceResetPolicyCode,
  parts: SequenceDateParts,
): string {
  switch (resetPolicy) {
    case SEQUENCE_RESET_POLICY.NEVER:
      return 'ALL';
    case SEQUENCE_RESET_POLICY.YEARLY:
      return parts.yyyy;
    case SEQUENCE_RESET_POLICY.MONTHLY:
      return `${parts.yyyy}-${parts.mm}`;
    case SEQUENCE_RESET_POLICY.DAILY:
      return `${parts.yyyy}-${parts.mm}-${parts.dd}`;
    default:
      return parts.yyyy;
  }
}

/**
 * Tính khóa phạm vi đơn vị (`unitScopeKey`) và mã hiển thị đơn vị (`unitSegment`) (Mục 5.5.6).
 */
export function computeSequenceUnitScope(params: {
  scopeByUnit: boolean;
  organizationUnitId?: number | string | null | undefined;
  unitCode?: string | null | undefined;
}): {
  organizationUnitId: number | null;
  unitScopeKey: string;
  unitSegment: string;
} {
  const parsedOrgId =
    params.organizationUnitId !== undefined &&
    params.organizationUnitId !== null &&
    String(params.organizationUnitId).trim() !== '' &&
    Number.isInteger(Number(params.organizationUnitId)) &&
    Number(params.organizationUnitId) > 0
      ? Number(params.organizationUnitId)
      : null;

  const cleanUnitCode = params.unitCode
    ? params.unitCode
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, '')
    : '';

  if (!params.scopeByUnit) {
    return {
      organizationUnitId: parsedOrgId,
      unitScopeKey: 'GLOBAL',
      unitSegment: cleanUnitCode,
    };
  }

  if (parsedOrgId !== null) {
    return {
      organizationUnitId: parsedOrgId,
      unitScopeKey: `UNIT:${parsedOrgId}`,
      unitSegment: cleanUnitCode || `U${parsedOrgId}`,
    };
  }

  if (cleanUnitCode) {
    return {
      organizationUnitId: null,
      unitScopeKey: `UNIT:${cleanUnitCode}`,
      unitSegment: cleanUnitCode,
    };
  }

  return {
    organizationUnitId: null,
    unitScopeKey: 'GLOBAL',
    unitSegment: '',
  };
}

/**
 * Xây dựng biểu thức mẫu (`resolvedTemplate`) từ cấu hình quy tắc sinh mã.
 */
export function buildDefaultSequenceTemplate(rule: {
  prefix: string;
  suffix: string;
  separator: string;
  dateFormat: SequenceDateFormatCode;
  scopeByUnit: boolean;
  templatePattern?: string | null | undefined;
  hasUnitSegment?: boolean | undefined;
}): string {
  const customTemplate = rule.templatePattern?.trim();
  if (customTemplate) {
    return customTemplate;
  }

  const sep = rule.separator ?? '-';
  const tokens: string[] = [];
  if (rule.prefix.trim()) {
    tokens.push('{PREFIX}');
  }
  if (rule.scopeByUnit && (rule.hasUnitSegment ?? true)) {
    tokens.push('{UNIT}');
  }
  if (rule.dateFormat !== SEQUENCE_DATE_FORMAT.NONE) {
    tokens.push('{DATE}');
  }
  tokens.push('{SEQ}');
  if (rule.suffix.trim()) {
    tokens.push('{SUFFIX}');
  }
  return tokens.join(sep);
}

/**
 * Sinh chuỗi mã nghiệp vụ hoàn chỉnh từ quy tắc, số thứ tự và ngữ cảnh (Mục 5.5.1 -> 5.5.7).
 * Ví dụ: `ORD-2026-000001` hoặc `CTR-HCM-202610-000015-VN`.
 */
export function formatSequenceCode(
  rule: {
    prefix: string;
    suffix: string;
    separator: string;
    dateFormat: SequenceDateFormatCode;
    paddingLength: number;
    scopeByUnit: boolean;
    timezone?: string | undefined;
    templatePattern?: string | null | undefined;
  },
  sequenceNumber: number,
  context?: SequenceGenerateContext,
): {
  code: string;
  paddedSequence: string;
  dateSegment: string;
  periodDateParts: SequenceDateParts;
  resolvedTemplate: string;
  organizationUnitId: number | null;
  unitScopeKey: string;
} {
  const tz = context?.timezone?.trim() || rule.timezone?.trim() || 'Asia/Ho_Chi_Minh';
  const dateParts = resolveSequenceDateParts(context?.at, tz);
  const dateSegment = formatSequenceDateSegment(rule.dateFormat, dateParts);
  const unitInfo = computeSequenceUnitScope({
    scopeByUnit: rule.scopeByUnit,
    organizationUnitId: context?.organizationUnitId,
    unitCode: context?.unitCode,
  });

  const safeSeq = Math.max(0, Math.trunc(sequenceNumber));
  const paddedSequence = String(safeSeq).padStart(rule.paddingLength, '0');
  const customTemplate = rule.templatePattern?.trim();

  if (customTemplate) {
    let rendered = customTemplate
      .replace(/\{PREFIX\}/gi, rule.prefix.trim())
      .replace(/\{SUFFIX\}/gi, rule.suffix.trim())
      .replace(/\{UNIT\}/gi, unitInfo.unitSegment)
      .replace(/\{DATE\}/gi, dateSegment)
      .replace(/\{YYYY\}/gi, dateParts.yyyy)
      .replace(/\{YY\}/gi, dateParts.yy)
      .replace(/\{MM\}/gi, dateParts.mm)
      .replace(/\{DD\}/gi, dateParts.dd)
      .replace(/\{SEQ:(\d+)\}/gi, (_m, lenStr: string) => {
        const len = Math.min(16, Math.max(1, Number(lenStr) || rule.paddingLength));
        return String(safeSeq).padStart(len, '0');
      })
      .replace(/\{SEQ\}/gi, paddedSequence);

    const sep = rule.separator ?? '-';
    if (sep) {
      const escapedSep = sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      rendered = rendered
        .replace(new RegExp(`${escapedSep}{2,}`, 'g'), sep)
        .replace(new RegExp(`^${escapedSep}|${escapedSep}$`, 'g'), '');
    }

    return {
      code: rendered,
      paddedSequence,
      dateSegment,
      periodDateParts: dateParts,
      resolvedTemplate: customTemplate,
      organizationUnitId: unitInfo.organizationUnitId,
      unitScopeKey: unitInfo.unitScopeKey,
    };
  }

  const segments: string[] = [];
  if (rule.prefix.trim()) {
    segments.push(rule.prefix.trim());
  }
  if (rule.scopeByUnit && unitInfo.unitSegment) {
    segments.push(unitInfo.unitSegment);
  }
  if (dateSegment) {
    segments.push(dateSegment);
  }
  segments.push(paddedSequence);
  if (rule.suffix.trim()) {
    segments.push(rule.suffix.trim());
  }

  const code = segments.join(rule.separator ?? '-');
  const resolvedTemplate = buildDefaultSequenceTemplate({
    ...rule,
    hasUnitSegment: Boolean(unitInfo.unitSegment),
  });

  return {
    code,
    paddedSequence,
    dateSegment,
    periodDateParts: dateParts,
    resolvedTemplate,
    organizationUnitId: unitInfo.organizationUnitId,
    unitScopeKey: unitInfo.unitScopeKey,
  };
}

/**
 * Kiểm tra và chuẩn hóa toàn bộ thông số cấu hình quy tắc sinh mã (Mục 5.5.1 -> 5.5.7).
 */
export function validateSequenceRule(input: {
  key?: string | undefined;
  name?: string | undefined;
  prefix?: string | undefined;
  suffix?: string | undefined;
  separator?: string | undefined;
  dateFormat?: SequenceDateFormatCode | SequenceDateFormatName | string | number | undefined;
  templatePattern?: string | null | undefined;
  paddingLength?: number | undefined;
  startValue?: number | undefined;
  step?: number | undefined;
  resetPolicy?: SequenceResetPolicyCode | SequenceResetPolicyName | string | number | undefined;
  scopeByUnit?: boolean | undefined;
  timezone?: string | undefined;
  requireKeyAndName?: boolean | undefined;
}): {
  key: string;
  name: string;
  prefix: string;
  suffix: string;
  separator: string;
  dateFormat: SequenceDateFormatCode;
  dateFormatName: SequenceDateFormatName;
  templatePattern: string | null;
  paddingLength: number;
  startValue: number;
  step: number;
  resetPolicy: SequenceResetPolicyCode;
  resetPolicyName: SequenceResetPolicyName;
  scopeByUnit: boolean;
  timezone: string;
} {
  const requireKeyAndName = input.requireKeyAndName ?? true;
  const key = (input.key ?? 'preview.sequence').trim().toLowerCase();
  const fieldPrefix = `Sequence '${key}'`;

  if (requireKeyAndName) {
    if (!key || !/^[a-z0-9][a-z0-9._-]*\.[a-z0-9._-]+$/i.test(key)) {
      throw new ValidationAppException(
        [
          {
            field: 'key',
            message: `${fieldPrefix} key must follow <module>.<sequence_name> format`,
            code: VALIDATION_ISSUE_CODE.INVALID_FORMAT,
          },
        ],
        `${fieldPrefix} key must follow <module>.<sequence_name> format`,
      );
    }

    if (!input.name || input.name.trim().length < 2) {
      throw new ValidationAppException(
        [
          {
            field: 'name',
            message: `${fieldPrefix} name must be at least 2 characters`,
            code: VALIDATION_ISSUE_CODE.INVALID_VALUE,
          },
        ],
        `${fieldPrefix} name must be at least 2 characters`,
      );
    }
  }

  const prefix = (input.prefix ?? '').trim().toUpperCase();
  if (prefix.length > 32 || (prefix.length > 0 && !/^[A-Z0-9._/-]+$/.test(prefix))) {
    throw new ValidationAppException(
      [
        {
          field: 'prefix',
          message: `${fieldPrefix} prefix must be 0..32 alphanumeric/code characters ([A-Z0-9._/-])`,
          code: VALIDATION_ISSUE_CODE.INVALID_FORMAT,
        },
      ],
      `${fieldPrefix} prefix is invalid`,
    );
  }

  const suffix = (input.suffix ?? '').trim().toUpperCase();
  if (suffix.length > 32 || (suffix.length > 0 && !/^[A-Z0-9._/-]+$/.test(suffix))) {
    throw new ValidationAppException(
      [
        {
          field: 'suffix',
          message: `${fieldPrefix} suffix must be 0..32 alphanumeric/code characters ([A-Z0-9._/-])`,
          code: VALIDATION_ISSUE_CODE.INVALID_FORMAT,
        },
      ],
      `${fieldPrefix} suffix is invalid`,
    );
  }

  const separator = input.separator !== undefined ? input.separator : '-';
  if (separator.length > 4 || !/^[-/_.:]*$/.test(separator)) {
    throw new ValidationAppException(
      [
        {
          field: 'separator',
          message: `${fieldPrefix} separator must be at most 4 characters from [-/_.:]`,
          code: VALIDATION_ISSUE_CODE.INVALID_FORMAT,
        },
      ],
      `${fieldPrefix} separator is invalid`,
    );
  }

  const dateFormat = resolveSequenceDateFormatCode(input.dateFormat);
  const dateFormatName = SEQUENCE_DATE_FORMAT_NAME_BY_CODE[dateFormat];

  const resetPolicy = resolveSequenceResetPolicyCode(input.resetPolicy);
  const resetPolicyName = SEQUENCE_RESET_POLICY_NAME_BY_CODE[resetPolicy];

  const paddingLength = input.paddingLength ?? 6;
  if (
    typeof paddingLength !== 'number' ||
    !Number.isInteger(paddingLength) ||
    paddingLength < 1 ||
    paddingLength > 12
  ) {
    throw new ValidationAppException(
      [
        {
          field: 'paddingLength',
          message: `${fieldPrefix} paddingLength must be an integer between 1 and 12`,
          code: VALIDATION_ISSUE_CODE.INVALID_VALUE,
        },
      ],
      `${fieldPrefix} paddingLength must be an integer between 1 and 12`,
    );
  }

  const startValue = input.startValue ?? 1;
  if (
    typeof startValue !== 'number' ||
    !Number.isInteger(startValue) ||
    startValue < 1 ||
    startValue > 999999999
  ) {
    throw new ValidationAppException(
      [
        {
          field: 'startValue',
          message: `${fieldPrefix} startValue must be a positive integer (>= 1)`,
          code: VALIDATION_ISSUE_CODE.INVALID_VALUE,
        },
      ],
      `${fieldPrefix} startValue must be a positive integer (>= 1)`,
    );
  }

  const step = input.step ?? 1;
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 1 || step > 10000) {
    throw new ValidationAppException(
      [
        {
          field: 'step',
          message: `${fieldPrefix} step must be an integer between 1 and 10000`,
          code: VALIDATION_ISSUE_CODE.INVALID_VALUE,
        },
      ],
      `${fieldPrefix} step must be an integer between 1 and 10000`,
    );
  }

  const templatePattern = input.templatePattern?.trim() ? input.templatePattern.trim() : null;
  if (templatePattern !== null && !/\{SEQ(?::\d+)?\}/i.test(templatePattern)) {
    throw new ValidationAppException(
      [
        {
          field: 'templatePattern',
          message: `${fieldPrefix} templatePattern must contain the {SEQ} placeholder`,
          code: VALIDATION_ISSUE_CODE.INVALID_FORMAT,
        },
      ],
      `${fieldPrefix} templatePattern must contain the {SEQ} placeholder`,
    );
  }

  const timezone = input.timezone?.trim() || 'Asia/Ho_Chi_Minh';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new ValidationAppException(
      [
        {
          field: 'timezone',
          message: `${fieldPrefix} timezone '${timezone}' is not a valid IANA timezone`,
          code: VALIDATION_ISSUE_CODE.INVALID_VALUE,
        },
      ],
      `${fieldPrefix} timezone '${timezone}' is not a valid IANA timezone`,
    );
  }

  return {
    key,
    name: (input.name ?? 'Preview Sequence').trim(),
    prefix,
    suffix,
    separator,
    dateFormat,
    dateFormatName,
    templatePattern,
    paddingLength,
    startValue,
    step,
    resetPolicy,
    resetPolicyName,
    scopeByUnit: Boolean(input.scopeByUnit),
    timezone,
  };
}

/**
 * Quét tự động toàn bộ mục `"sequences"` từ `module.manifest.json` của các module.
 * Tái sử dụng `scanModuleManifests()` từ `@packages/kernel` theo đúng quy chuẩn chống lặp code.
 */
export function discoverManifestSequences(): SequenceManifestItem[] {
  const discovered = new Map<string, SequenceManifestItem>();
  const manifests = scanModuleManifests<{
    name?: string;
    sequences?: SequenceManifestItem[];
  }>();

  for (const entry of manifests) {
    const items = entry.raw.sequences;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item.key !== 'string' || !item.key.trim()) continue;
      const normalizedKey = item.key.trim().toLowerCase();
      discovered.set(normalizedKey, {
        ...item,
        key: normalizedKey,
        module: (item.module ?? entry.moduleName).trim().toLowerCase(),
      });
    }
  }

  return Array.from(discovered.values());
}

/**
 * L1 Sequence Registry & Concurrency-Safe Generator tại `@packages/kernel` (Mục 5.5).
 * Cho phép bất kỳ module nào trong hệ thống tra cứu quy tắc, xem trước mẫu mã hoặc sinh mã tuần tự
 * an toàn khi nhiều request gọi đồng thời.
 */
@Injectable()
export class SequenceRegistryService {
  private readonly rules = new Map<string, RegisteredSequenceRuleDefinition>();
  private readonly counters = new Map<string, SequenceCounterSnapshot>();
  private readonly scopeLocks = new Map<string, Promise<void>>();
  private readonly listeners = new Set<SequenceRuleChangeListener>();

  /** Đăng ký hoặc cập nhật một quy tắc sinh mã vào L1 Registry */
  public registerRule(
    rule: RegisteredSequenceRuleDefinition,
    options?: { silent?: boolean },
  ): RegisteredSequenceRuleDefinition {
    const normalizedKey = rule.key.trim().toLowerCase();
    const entry: RegisteredSequenceRuleDefinition = {
      ...rule,
      key: normalizedKey,
      module: rule.module.trim().toLowerCase(),
      updatedAt: rule.updatedAt ?? new Date().toISOString(),
    };
    this.rules.set(normalizedKey, entry);

    if (!options?.silent) {
      for (const listener of this.listeners) {
        void Promise.resolve(
          listener({
            key: entry.key,
            module: entry.module,
          }),
        );
      }
    }
    return entry;
  }

  /** Đồng bộ danh sách quy tắc từ `module.manifest.json` vào L1 Registry */
  public registerManifestSequences(items?: readonly SequenceManifestItem[]): number {
    const list = items ?? discoverManifestSequences();
    let count = 0;
    for (const item of list) {
      const validated = validateSequenceRule({
        key: item.key,
        name: item.name,
        prefix: item.prefix,
        suffix: item.suffix,
        separator: item.separator,
        dateFormat: item.dateFormat,
        templatePattern: item.templatePattern,
        paddingLength: item.paddingLength,
        startValue: item.startValue,
        step: item.step,
        resetPolicy: item.resetPolicy,
        scopeByUnit: item.scopeByUnit,
        timezone: item.timezone,
      });
      const existing = this.rules.get(validated.key);
      if (existing) continue;

      this.registerRule(
        {
          key: validated.key,
          module: (item.module ?? validated.key.split('.')[0] ?? 'settings').trim().toLowerCase(),
          name: validated.name,
          description: item.description?.trim() ?? null,
          prefix: validated.prefix,
          suffix: validated.suffix,
          separator: validated.separator,
          dateFormat: validated.dateFormat,
          dateFormatName: validated.dateFormatName,
          templatePattern: validated.templatePattern,
          paddingLength: validated.paddingLength,
          startValue: validated.startValue,
          step: validated.step,
          resetPolicy: validated.resetPolicy,
          resetPolicyName: validated.resetPolicyName,
          scopeByUnit: validated.scopeByUnit,
          timezone: validated.timezone,
          isSystem: item.isSystem ?? true,
          status: (item.status as SequenceStatusCode | undefined) ?? SEQUENCE_STATUS.ACTIVE,
        },
        { silent: true },
      );
      count++;
    }
    return count;
  }

  public getRule(key: string): RegisteredSequenceRuleDefinition | null {
    return this.rules.get(key.trim().toLowerCase()) ?? null;
  }

  public listRules(filter?: {
    module?: string | undefined;
    status?: number | undefined;
    search?: string | undefined;
  }): RegisteredSequenceRuleDefinition[] {
    let items = Array.from(this.rules.values());
    if (filter?.module) {
      const mod = filter.module.trim().toLowerCase();
      items = items.filter((r) => r.module === mod);
    }
    if (filter?.status !== undefined) {
      items = items.filter((r) => r.status === filter.status);
    }
    if (filter?.search) {
      const q = filter.search.trim().toLowerCase();
      items = items.filter(
        (r) =>
          r.key.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q) ||
          r.prefix.toLowerCase().includes(q),
      );
    }
    return items.sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * 5.5.7: Xem trước mẫu mã trước khi áp dụng (tránh cấu hình sai, tuyệt đối không tăng bộ đếm).
   */
  public preview(input: SequencePreviewInput): SequencePreviewResult {
    const existing = input.key ? this.getRule(input.key) : null;
    const validated = validateSequenceRule({
      key: input.key ?? existing?.key ?? 'preview.sequence',
      name: existing?.name ?? 'Preview Sequence',
      prefix: input.prefix ?? existing?.prefix ?? '',
      suffix: input.suffix ?? existing?.suffix ?? '',
      separator: input.separator ?? existing?.separator ?? '-',
      dateFormat: input.dateFormat ?? existing?.dateFormat ?? SEQUENCE_DATE_FORMAT.YYYY,
      templatePattern:
        input.templatePattern !== undefined
          ? input.templatePattern
          : (existing?.templatePattern ?? null),
      paddingLength: input.paddingLength ?? existing?.paddingLength ?? 6,
      startValue: input.startValue ?? existing?.startValue ?? 1,
      step: input.step ?? existing?.step ?? 1,
      resetPolicy: input.resetPolicy ?? existing?.resetPolicy ?? SEQUENCE_RESET_POLICY.YEARLY,
      scopeByUnit: input.scopeByUnit ?? existing?.scopeByUnit ?? false,
      timezone: input.timezone ?? existing?.timezone ?? 'Asia/Ho_Chi_Minh',
      requireKeyAndName: false,
    });

    const firstSeq =
      input.sampleSequenceNumber !== undefined && input.sampleSequenceNumber >= 1
        ? Math.trunc(input.sampleSequenceNumber)
        : validated.startValue;

    const context: SequenceGenerateContext = {
      organizationUnitId: input.organizationUnitId,
      unitCode: input.unitCode ?? (validated.scopeByUnit ? 'HCM' : undefined),
      at: input.at,
      timezone: validated.timezone,
    };

    const firstFormatted = formatSequenceCode(validated, firstSeq, context);
    const secondFormatted = formatSequenceCode(validated, firstSeq + validated.step, context);
    const thirdFormatted = formatSequenceCode(validated, firstSeq + validated.step * 2, context);
    const periodKey = computeSequencePeriodKey(
      validated.resetPolicy,
      firstFormatted.periodDateParts,
    );

    return {
      sampleCode: firstFormatted.code,
      nextSampleCodes: [firstFormatted.code, secondFormatted.code, thirdFormatted.code],
      resolvedTemplate: firstFormatted.resolvedTemplate,
      dateFormat: validated.dateFormat,
      dateFormatName: validated.dateFormatName,
      resetPolicy: validated.resetPolicy,
      resetPolicyName: validated.resetPolicyName,
      periodKey,
      unitScopeKey: firstFormatted.unitScopeKey,
      dateSegment: firstFormatted.dateSegment,
      paddingLength: validated.paddingLength,
      startValue: validated.startValue,
      step: validated.step,
    };
  }

  /**
   * 5.5.4 -> 5.5.6: Sinh một mã nghiệp vụ tiếp theo an toàn đồng thời (Concurrency-Safe).
   */
  public async nextCode(
    key: string,
    context?: SequenceGenerateContext,
  ): Promise<SequenceGeneratedResult> {
    const batch = await this.nextBatch(key, 1, context);
    return batch[0]!;
  }

  /**
   * Sinh một lô `count` mã nghiệp vụ liên tiếp an toàn đồng thời (Zero Duplicate).
   * Có thể truyền `customAllocator` (ví dụ: DB Atomic Upsert từ `SequencesService`) bên trong khóa tuần tự.
   */
  public async nextBatch(
    key: string,
    count = 1,
    context?: SequenceGenerateContext,
    customAllocator?: (params: {
      rule: RegisteredSequenceRuleDefinition;
      periodKey: string;
      organizationUnitId: number | null;
      unitScopeKey: string;
      count: number;
    }) => Promise<number[]>,
  ): Promise<SequenceGeneratedResult[]> {
    const normalizedKey = key.trim().toLowerCase();
    const rule = this.getRule(normalizedKey);
    if (!rule) {
      throw new NotFoundAppException(`Sequence rule '${normalizedKey}' not found`);
    }

    const safeCount = Math.min(500, Math.max(1, Math.trunc(count)));
    const tz = context?.timezone?.trim() || rule.timezone || 'Asia/Ho_Chi_Minh';
    const dateParts = resolveSequenceDateParts(context?.at, tz);
    const periodKey = computeSequencePeriodKey(rule.resetPolicy, dateParts);
    const unitInfo = computeSequenceUnitScope({
      scopeByUnit: rule.scopeByUnit,
      organizationUnitId: context?.organizationUnitId,
      unitCode: context?.unitCode,
    });

    const counterMapKey = this.buildCounterKey(normalizedKey, periodKey, unitInfo.unitScopeKey);

    return this.withScopeLock(counterMapKey, async () => {
      let allocatedNumbers: number[];

      if (customAllocator) {
        allocatedNumbers = await customAllocator({
          rule,
          periodKey,
          organizationUnitId: unitInfo.organizationUnitId,
          unitScopeKey: unitInfo.unitScopeKey,
          count: safeCount,
        });
      } else {
        const existingCounter = this.counters.get(counterMapKey);
        let currentVal = existingCounter?.currentValue ?? 0;
        allocatedNumbers = [];
        for (let i = 0; i < safeCount; i++) {
          if (currentVal === 0) {
            currentVal = rule.startValue;
          } else {
            currentVal = Math.max(currentVal + rule.step, rule.startValue);
          }
          allocatedNumbers.push(currentVal);
        }
      }

      const lastValue = allocatedNumbers[allocatedNumbers.length - 1] ?? rule.startValue;
      const nowIso = new Date().toISOString();
      this.counters.set(counterMapKey, {
        sequenceKey: normalizedKey,
        periodKey,
        organizationUnitId: unitInfo.organizationUnitId,
        unitScopeKey: unitInfo.unitScopeKey,
        currentValue: lastValue,
        updatedAt: nowIso,
      });

      return allocatedNumbers.map((seqNum) => {
        const formatted = formatSequenceCode(rule, seqNum, context);
        return {
          key: rule.key,
          module: rule.module,
          code: formatted.code,
          sequenceNumber: seqNum,
          paddedSequence: formatted.paddedSequence,
          periodKey,
          unitScopeKey: unitInfo.unitScopeKey,
          organizationUnitId: unitInfo.organizationUnitId,
          dateSegment: formatted.dateSegment,
          generatedAt: nowIso,
        };
      });
    });
  }

  /** Đồng bộ giá trị bộ đếm từ DB vào L1 Registry */
  public setCounterSnapshot(snapshot: SequenceCounterSnapshot): void {
    const mapKey = this.buildCounterKey(
      snapshot.sequenceKey,
      snapshot.periodKey,
      snapshot.unitScopeKey,
    );
    this.counters.set(mapKey, snapshot);
  }

  public getCounters(sequenceKey?: string): SequenceCounterSnapshot[] {
    const items = Array.from(this.counters.values());
    if (!sequenceKey) return items;
    const normalized = sequenceKey.trim().toLowerCase();
    return items.filter((c) => c.sequenceKey === normalized);
  }

  public onRuleChanged(listener: SequenceRuleChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public clear(): void {
    this.rules.clear();
    this.counters.clear();
    this.scopeLocks.clear();
  }

  private buildCounterKey(sequenceKey: string, periodKey: string, unitScopeKey: string): string {
    return `${sequenceKey.trim().toLowerCase()}::${periodKey}::${unitScopeKey}`;
  }

  /**
   * Hàng đợi khóa nguyên tử theo từng `(sequenceKey, periodKey, unitScopeKey)`.
   * Đảm bảo khi nhiều request gọi `Promise.all([nextCode(), nextCode(), ...])` cùng lúc,
   * các lời gọi trong cùng 1 phạm vi được xếp hàng thực thi tuần tự 100% không bao giờ trùng số.
   */
  private async withScopeLock<T>(lockKey: string, work: () => Promise<T>): Promise<T> {
    const previous = this.scopeLocks.get(lockKey) ?? Promise.resolve();
    let releaseLock!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const chainedLock = previous.then(() => currentLock);
    this.scopeLocks.set(lockKey, chainedLock);

    await previous;
    try {
      return await work();
    } finally {
      releaseLock();
      if (this.scopeLocks.get(lockKey) === chainedLock) {
        this.scopeLocks.delete(lockKey);
      }
    }
  }
}

export const defaultSequenceRegistry = new SequenceRegistryService();

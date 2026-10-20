import { VALIDATION_ISSUE_CODE, ValidationAppException } from '../errors/http-exceptions.js';
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

function throwSequenceValidation(
  field: string,
  message: string,
  code: string,
  summary = message,
): never {
  throw new ValidationAppException([{ field, message, code }], summary);
}

function validateSequenceAffixAndSeparator(
  fieldPrefix: string,
  rawPrefix: string | undefined,
  rawSuffix: string | undefined,
  rawSeparator: string | undefined,
): { prefix: string; suffix: string; separator: string } {
  const prefix = (rawPrefix ?? '').trim().toUpperCase();
  if (prefix.length > 32 || (prefix.length > 0 && !/^[A-Z0-9._/-]+$/.test(prefix))) {
    throwSequenceValidation(
      'prefix',
      `${fieldPrefix} prefix must be 0..32 alphanumeric/code characters ([A-Z0-9._/-])`,
      VALIDATION_ISSUE_CODE.INVALID_FORMAT,
      `${fieldPrefix} prefix is invalid`,
    );
  }

  const suffix = (rawSuffix ?? '').trim().toUpperCase();
  if (suffix.length > 32 || (suffix.length > 0 && !/^[A-Z0-9._/-]+$/.test(suffix))) {
    throwSequenceValidation(
      'suffix',
      `${fieldPrefix} suffix must be 0..32 alphanumeric/code characters ([A-Z0-9._/-])`,
      VALIDATION_ISSUE_CODE.INVALID_FORMAT,
      `${fieldPrefix} suffix is invalid`,
    );
  }

  const separator = rawSeparator !== undefined ? rawSeparator : '-';
  if (separator.length > 4 || !/^[-/_.:]*$/.test(separator)) {
    throwSequenceValidation(
      'separator',
      `${fieldPrefix} separator must be at most 4 characters from [-/_.:]`,
      VALIDATION_ISSUE_CODE.INVALID_FORMAT,
      `${fieldPrefix} separator is invalid`,
    );
  }

  return { prefix, suffix, separator };
}

function validateSequenceNumericBounds(
  fieldPrefix: string,
  rawPaddingLength: number | undefined,
  rawStartValue: number | undefined,
  rawStep: number | undefined,
): { paddingLength: number; startValue: number; step: number } {
  const paddingLength = rawPaddingLength ?? 6;
  if (
    typeof paddingLength !== 'number' ||
    !Number.isInteger(paddingLength) ||
    paddingLength < 1 ||
    paddingLength > 12
  ) {
    throwSequenceValidation(
      'paddingLength',
      `${fieldPrefix} paddingLength must be an integer between 1 and 12`,
      VALIDATION_ISSUE_CODE.INVALID_VALUE,
    );
  }

  const startValue = rawStartValue ?? 1;
  if (
    typeof startValue !== 'number' ||
    !Number.isInteger(startValue) ||
    startValue < 1 ||
    startValue > 999999999
  ) {
    throwSequenceValidation(
      'startValue',
      `${fieldPrefix} startValue must be a positive integer (>= 1)`,
      VALIDATION_ISSUE_CODE.INVALID_VALUE,
    );
  }

  const step = rawStep ?? 1;
  if (typeof step !== 'number' || !Number.isInteger(step) || step < 1 || step > 10000) {
    throwSequenceValidation(
      'step',
      `${fieldPrefix} step must be an integer between 1 and 10000`,
      VALIDATION_ISSUE_CODE.INVALID_VALUE,
    );
  }

  return { paddingLength, startValue, step };
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
      throwSequenceValidation(
        'key',
        `${fieldPrefix} key must follow <module>.<sequence_name> format`,
        VALIDATION_ISSUE_CODE.INVALID_FORMAT,
      );
    }

    if (!input.name || input.name.trim().length < 2) {
      throwSequenceValidation(
        'name',
        `${fieldPrefix} name must be at least 2 characters`,
        VALIDATION_ISSUE_CODE.INVALID_VALUE,
      );
    }
  }

  const { prefix, suffix, separator } = validateSequenceAffixAndSeparator(
    fieldPrefix,
    input.prefix,
    input.suffix,
    input.separator,
  );
  const dateFormat = resolveSequenceDateFormatCode(input.dateFormat);
  const dateFormatName = SEQUENCE_DATE_FORMAT_NAME_BY_CODE[dateFormat];
  const resetPolicy = resolveSequenceResetPolicyCode(input.resetPolicy);
  const resetPolicyName = SEQUENCE_RESET_POLICY_NAME_BY_CODE[resetPolicy];
  const { paddingLength, startValue, step } = validateSequenceNumericBounds(
    fieldPrefix,
    input.paddingLength,
    input.startValue,
    input.step,
  );

  const templatePattern = input.templatePattern?.trim() ? input.templatePattern.trim() : null;
  if (templatePattern !== null && !/\{SEQ(?::\d+)?\}/i.test(templatePattern)) {
    throwSequenceValidation(
      'templatePattern',
      `${fieldPrefix} templatePattern must contain the {SEQ} placeholder`,
      VALIDATION_ISSUE_CODE.INVALID_FORMAT,
    );
  }

  const timezone = input.timezone?.trim() || 'Asia/Ho_Chi_Minh';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throwSequenceValidation(
      'timezone',
      `${fieldPrefix} timezone '${timezone}' is not a valid IANA timezone`,
      VALIDATION_ISSUE_CODE.INVALID_VALUE,
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

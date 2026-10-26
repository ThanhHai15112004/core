import type { SettingResolveContext } from '../contracts/setting-lookup.contract.js';
import { ValidationAppException } from '../errors/http-exceptions.js';
import {
  SettingRegistryService,
  defaultSettingRegistry,
} from '../registries/setting-registry.service.js';

/**
 * Các giá trị mặc định và ngưỡng giới hạn cho phân trang dữ liệu.
 */
export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  LIMIT: 20,
  MIN_LIMIT: 1,
  MAX_LIMIT: 100,
  /** Ngưỡng offset tối đa cho phép nhằm tránh truy vấn quét sâu (Deep Offset Scan) trên bảng lớn. */
  MAX_OFFSET: 10_000,
} as const;

export const SELECT_DEFAULTS = {
  MAX_FIELDS: 30,
  PRIMARY_KEY: 'id',
} as const;

/**
 * Ngưỡng bảo vệ độ phức tạp của truy vấn danh sách (Mục 8.1 — Tránh query quá nặng).
 */
export const QUERY_COMPLEXITY_DEFAULTS = {
  MAX_LIMIT: 100,
  MAX_OFFSET: 10_000,
  MAX_SORT_FIELDS: 3,
  MAX_FILTER_CONDITIONS: 10,
  MAX_IN_VALUES: 50,
  MAX_SEARCH_LENGTH: 200,
  MAX_SEARCH_TOKENS: 10,
  MAX_SELECT_FIELDS: 30,
} as const;

/** Tham số đầu vào thô của phân trang (từ Query DTO hoặc Filter). */
export interface RawPaginationInput {
  readonly page?: number | string | null | undefined;
  readonly limit?: number | string | null | undefined;
  readonly countMode?: CountMode | null | undefined;
}

/** Tùy chọn phân giải phân trang tập trung kết hợp Cấu hình động (SettingRegistryService). */
export interface ResolvePaginationOptions {
  /**
   * Tiền tố khóa cấu hình động (ví dụ: `'users.pagination'`, `'roles.audit_log'`).
   * Tự động tra cứu `<settingPrefix>.default_page_size` và `<settingPrefix>.max_page_size`.
   */
  readonly settingPrefix?: string | undefined;
  /** Khóa cấu hình động cho `limit` mặc định (ghi đè `settingPrefix`). */
  readonly defaultLimitKey?: string | undefined;
  /** Khóa cấu hình động cho `limit` tối đa (ghi đè `settingPrefix`). */
  readonly maxLimitKey?: string | undefined;
  /** Khóa cấu hình động cho `maxOffset` tối đa. */
  readonly maxOffsetKey?: string | undefined;
  /** Giá trị `limit` mặc định fallback khi chưa cấu hình (mặc định `PAGINATION_DEFAULTS.LIMIT = 20`). */
  readonly defaultLimit?: number | undefined;
  /** Giá trị `limit` tối đa fallback khi chưa cấu hình (mặc định `PAGINATION_DEFAULTS.MAX_LIMIT = 100`). */
  readonly maxLimit?: number | undefined;
  /** Giá trị `limit` tối thiểu (mặc định `PAGINATION_DEFAULTS.MIN_LIMIT = 1`). */
  readonly minLimit?: number | undefined;
  /** Ngưỡng `offset` tối đa nhằm chặn Deep Offset Scan (mặc định `PAGINATION_DEFAULTS.MAX_OFFSET = 10_000`). */
  readonly maxOffset?: number | undefined;
  /** Bật/tắt chặn lỗi khi `offset > maxOffset` (mặc định `true`). */
  readonly enforceMaxOffset?: boolean | undefined;
  /** Chế độ đếm tổng bản ghi mặc định (`'exact'`, `'estimated'`, `'none'`). */
  readonly defaultCountMode?: CountMode | undefined;
  /** Ngữ cảnh đơn vị / môi trường khi phân giải cấu hình động. */
  readonly context?: SettingResolveContext | undefined;
  /** Tùy chọn truyền instance SettingRegistryService riêng (mặc định dùng `defaultSettingRegistry`). */
  readonly registry?: SettingRegistryService | undefined;
}

/** Kết quả phân trang đã chuẩn hóa, dùng trực tiếp cho cả Service (`page, limit`) và TypeORM (`skip, take, offset`). */
export interface ResolvedPaginationParams extends PaginationParams {
  readonly skip: number;
  readonly take: number;
  readonly countMode: CountMode;
}

/**
 * Hàm dùng chung chuẩn hóa tham số phân trang (`page`, `limit`, `offset`/`skip`, `take`) chỉ với 1 dòng gọi.
 * Tự động đọc cấu hình động từ `SettingRegistryService` theo thứ tự ưu tiên:
 * 1. Khóa riêng của module (`<settingPrefix>.default_page_size` / `<settingPrefix>.max_page_size` hoặc `defaultLimitKey` / `maxLimitKey`).
 * 2. Khóa toàn cục của hệ thống (`system.pagination.default_page_size` / `system.pagination.max_page_size`).
 * 3. Hằng số fallback truyền vào hoặc `PAGINATION_DEFAULTS`.
 */
export function resolvePagination(
  input?: RawPaginationInput | null,
  options?: ResolvePaginationOptions,
): ResolvedPaginationParams {
  const registry = options?.registry ?? defaultSettingRegistry;
  const ctx = options?.context;

  const globalDefaultLimit = registry.getNumber(
    'system.pagination.default_page_size',
    ctx,
    options?.defaultLimit ?? PAGINATION_DEFAULTS.LIMIT,
  );
  const globalMaxLimit = registry.getNumber(
    'system.pagination.max_page_size',
    ctx,
    options?.maxLimit ?? PAGINATION_DEFAULTS.MAX_LIMIT,
  );
  const globalMaxOffset = registry.getNumber(
    'system.pagination.max_offset',
    ctx,
    options?.maxOffset ?? PAGINATION_DEFAULTS.MAX_OFFSET,
  );

  const defaultLimitKey =
    options?.defaultLimitKey ??
    (options?.settingPrefix ? `${options.settingPrefix}.default_page_size` : undefined);
  const maxLimitKey =
    options?.maxLimitKey ??
    (options?.settingPrefix ? `${options.settingPrefix}.max_page_size` : undefined);
  const maxOffsetKey =
    options?.maxOffsetKey ??
    (options?.settingPrefix ? `${options.settingPrefix}.max_offset` : undefined);

  const fallbackDefault = options?.defaultLimit ?? globalDefaultLimit;
  const fallbackMax = options?.maxLimit ?? globalMaxLimit;
  const fallbackMaxOffset = options?.maxOffset ?? globalMaxOffset;

  const rawDefaultLimit = defaultLimitKey
    ? registry.getNumber(defaultLimitKey, ctx, fallbackDefault)
    : fallbackDefault;
  const rawMaxLimit = maxLimitKey ? registry.getNumber(maxLimitKey, ctx, fallbackMax) : fallbackMax;
  const rawMaxOffset = maxOffsetKey
    ? registry.getNumber(maxOffsetKey, ctx, fallbackMaxOffset)
    : fallbackMaxOffset;

  const minLimit = Math.max(1, Math.trunc(options?.minLimit ?? PAGINATION_DEFAULTS.MIN_LIMIT));
  const safeMaxLimit = Math.max(minLimit, Math.trunc(rawMaxLimit));
  const safeDefaultLimit = Math.min(safeMaxLimit, Math.max(minLimit, Math.trunc(rawDefaultLimit)));
  const safeMaxOffset = Math.max(safeMaxLimit, Math.trunc(rawMaxOffset));

  const parsedPage = Number(input?.page);
  const page =
    Number.isFinite(parsedPage) && parsedPage >= PAGINATION_DEFAULTS.PAGE
      ? Math.trunc(parsedPage)
      : PAGINATION_DEFAULTS.PAGE;

  const hasExplicitLimit =
    input?.limit !== undefined && input?.limit !== null && input?.limit !== '';
  const parsedLimit = hasExplicitLimit ? Number(input?.limit) : safeDefaultLimit;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit >= minLimit
      ? Math.min(safeMaxLimit, Math.trunc(parsedLimit))
      : hasExplicitLimit && Number.isFinite(parsedLimit) && parsedLimit < minLimit
        ? minLimit
        : safeDefaultLimit;

  const offset = (page - 1) * limit;
  if ((options?.enforceMaxOffset ?? true) && offset > safeMaxOffset) {
    throw new ValidationAppException([
      {
        field: 'page',
        code: 'offset_exceeded',
        message: `Offset (${offset}) exceeds maximum allowed offset (${safeMaxOffset}). Use cursor pagination for deep datasets.`,
      },
    ]);
  }

  const countMode: CountMode =
    input?.countMode && COUNT_MODES.includes(input.countMode)
      ? input.countMode
      : (options?.defaultCountMode ?? 'exact');

  return {
    page,
    limit,
    offset,
    skip: offset,
    take: limit,
    countMode,
  };
}

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export const SORT_DEFAULTS = {
  ORDER: 'desc' as SortOrder,
  MAX_FIELDS: 3,
  TIE_BREAKER_FIELD: 'id',
} as const;

export const CURSOR_DIRECTIONS = ['next', 'prev'] as const;
export type CursorDirection = (typeof CURSOR_DIRECTIONS)[number];

/**
 * Chế độ đếm tổng bản ghi khi phân trang trên tập dữ liệu lớn:
 * - `exact`: Chạy `COUNT(*)` chính xác (phù hợp bảng vừa và nhỏ).
 * - `estimated`: Dùng thống kê ước lượng hoặc giới hạn đếm.
 * - `none`: Không chạy `COUNT(*)`, chỉ dựa vào `limit + 1` để tính `hasNextPage` (chịu tải cao).
 */
export const COUNT_MODES = ['exact', 'estimated', 'none'] as const;
export type CountMode = (typeof COUNT_MODES)[number];

export const SEARCH_MODES = ['contains', 'startsWith', 'endsWith', 'fulltext'] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export const SEARCH_DEFAULTS = {
  MAX_LENGTH: 200,
  MAX_TOKENS: 10,
  MAX_ADVANCED_FILTERS: 10,
  DEFAULT_MODE: 'contains' as SearchMode,
} as const;

export const FILTER_OPERATORS = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'nin',
  'contains',
  'startsWith',
  'endsWith',
  'between',
  'isNull',
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

/** Tham số đầu vào đã chuẩn hóa cho phân trang theo trang (Offset Pagination). */
export interface PaginationParams {
  readonly page: number;
  readonly limit: number;
  readonly offset: number;
  readonly countMode?: CountMode;
}

/** Metadata chuẩn cho phân trang theo trang (Offset Pagination). */
export interface PaginationMeta extends Record<string, unknown> {
  readonly page: number;
  readonly limit: number;
  readonly total: number | null;
  readonly totalPages: number | null;
  readonly hasNextPage: boolean;
  readonly hasPrevPage: boolean;
}

/** Kết quả danh sách phân trang theo trang (Offset Pagination). */
export interface PaginatedResult<T> {
  readonly data: readonly T[];
  readonly meta: PaginationMeta;
}

/** Cấu trúc giải mã bên trong con trỏ phân trang (Keyset / Cursor Pagination). */
export interface CursorPayload<TValue = string | number | boolean | null> {
  readonly sortValue: TValue;
  readonly tieBreakerId: string | number;
  readonly sortBy?: string;
  readonly sortOrder?: SortOrder;
}

/** Tham số đầu vào cho phân trang con trỏ (Cursor / Keyset Pagination — tối ưu cho dữ liệu lớn). */
export interface CursorPaginationParams {
  readonly cursor: string | null;
  readonly limit: number;
  readonly direction: CursorDirection;
}

/** Metadata chuẩn cho phân trang con trỏ (Cursor / Keyset Pagination). */
export interface CursorPaginationMeta extends Record<string, unknown> {
  readonly limit: number;
  readonly nextCursor: string | null;
  readonly prevCursor: string | null;
  readonly hasNextPage: boolean;
  readonly hasPrevPage: boolean;
}

/** Kết quả danh sách phân trang theo con trỏ (Cursor / Keyset Pagination). */
export interface CursorPaginatedResult<T> {
  readonly data: readonly T[];
  readonly meta: CursorPaginationMeta;
}

/** Một tiêu chí sắp xếp đơn lẻ. */
export interface SortCriterion<TSortField extends string = string> {
  readonly field: TSortField;
  readonly order: SortOrder;
}

/** Tham số sắp xếp chuẩn (hỗ trợ sắp xếp đơn cột và đa cột). */
export interface SortParams<TSortField extends string = string> {
  readonly sortBy: TSortField;
  readonly sortOrder: SortOrder;
  readonly sortCriteria: readonly SortCriterion<TSortField>[];
}

/** Một điều kiện lọc nâng cao đã được xác thực qua whitelist. */
export interface FilterCondition<TField extends string = string, TValue = unknown> {
  readonly field: TField;
  readonly operator: FilterOperator;
  readonly value: TValue;
}

/** Kết quả phân tích cú pháp tìm kiếm nâng cao (Advanced Search Query). */
export interface AdvancedSearchParsed<TField extends string = string> {
  /** Chuỗi tìm kiếm gốc sau khi làm sạch. */
  readonly raw: string;
  /** Các từ khóa rời đã tách token. */
  readonly tokens: readonly string[];
  /** Các cụm từ chính xác nằm trong dấu ngoặc kép `"..."`. */
  readonly exactPhrases: readonly string[];
  /** Các từ khóa bị loại trừ có tiền tố `-term`. */
  readonly excludedTerms: readonly string[];
  /** Các bộ lọc theo trường trích xuất từ cú pháp `field:value` hoặc `field:>=value`. */
  readonly fieldConditions: readonly FilterCondition<TField, string | readonly string[]>[];
}

/** Đầu vào khoảng thời gian thô (hỗ trợ chuỗi ISO, Date hoặc timestamp). */
export interface DateRangeInput {
  readonly from?: string | Date | number | null | undefined;
  readonly to?: string | Date | number | null | undefined;
  readonly paramPrefix?: string | undefined;
  readonly fromFieldName?: string | undefined;
  readonly toFieldName?: string | undefined;
  readonly maxSpanDays?: number | undefined;
}

/** Kết quả chuẩn hóa khoảng thời gian đã qua kiểm tra hợp lệ (`from <= to`). */
export interface ResolvedDateRange {
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  readonly fromDate?: Date | undefined;
  readonly toDate?: Date | undefined;
  readonly fromIso?: string | undefined;
  readonly toIso?: string | undefined;
}

export interface ResolveDateRangeOptions {
  readonly fromFieldName?: string | undefined;
  readonly toFieldName?: string | undefined;
  /** Giới hạn số ngày tối đa giữa `from` và `to` nhằm tránh quét dữ liệu lịch sử quá lớn. */
  readonly maxSpanDays?: number | undefined;
}

/**
 * Chuẩn hóa và kiểm tra hợp lệ khoảng thời gian (`from`, `to`):
 * - Nếu chuỗi ngày sai định dạng ISO -> ném `ValidationAppException` (400).
 * - Nếu `from > to` -> ném `ValidationAppException` (400).
 * - Nếu khoảng cách vượt quá `maxSpanDays` -> ném `ValidationAppException` (400).
 */
export function resolveDateRange(
  fromRaw?: string | Date | number | null,
  toRaw?: string | Date | number | null,
  options?: ResolveDateRangeOptions,
): ResolvedDateRange {
  const fromField = options?.fromFieldName ?? 'from';
  const toField = options?.toFieldName ?? 'to';

  const parseSingleDate = (
    raw: string | Date | number | null | undefined,
    fieldName: string,
  ): Date | undefined => {
    if (raw === undefined || raw === null || raw === '') {
      return undefined;
    }
    if (raw instanceof Date) {
      if (Number.isNaN(raw.getTime())) {
        throw new ValidationAppException([
          {
            field: fieldName,
            code: 'invalid_date',
            message: `Invalid date value for "${fieldName}"`,
          },
        ]);
      }
      return raw;
    }
    const strVal = typeof raw === 'string' ? raw.trim() : String(raw);
    if (strVal.length === 0) {
      return undefined;
    }
    const ts = Date.parse(strVal);
    if (Number.isNaN(ts)) {
      throw new ValidationAppException([
        {
          field: fieldName,
          code: 'invalid_date',
          message: `Invalid ISO date string for "${fieldName}"`,
        },
      ]);
    }
    return new Date(ts);
  };

  const from = parseSingleDate(fromRaw, fromField);
  const to = parseSingleDate(toRaw, toField);

  if (from && to && from.getTime() > to.getTime()) {
    throw new ValidationAppException([
      {
        field: fromField,
        code: 'invalid_date_range',
        message: `"${fromField}" date must be earlier than or equal to "${toField}" date`,
      },
    ]);
  }

  if (from && to && options?.maxSpanDays !== undefined && options.maxSpanDays > 0) {
    const maxSpanMs = options.maxSpanDays * 86_400_000;
    if (to.getTime() - from.getTime() > maxSpanMs) {
      throw new ValidationAppException([
        {
          field: toField,
          code: 'date_range_too_wide',
          message: `Date range between "${fromField}" and "${toField}" cannot exceed ${options.maxSpanDays} days`,
        },
      ]);
    }
  }

  return {
    ...(from ? { from, fromDate: from, fromIso: from.toISOString() } : {}),
    ...(to ? { to, toDate: to, toIso: to.toISOString() } : {}),
  };
}

/**
 * Lọc bớt các trường không cần thiết trên một bản ghi hoặc danh sách bản ghi theo danh sách `fields` được chọn.
 * Luôn giữ lại các trường định danh bắt buộc trong `alwaysIncludeFields` (mặc định `['id']`).
 */
export function pickSelectedFields<T>(
  data: T,
  fields?: readonly string[] | null,
  alwaysIncludeFields: readonly string[] = [SELECT_DEFAULTS.PRIMARY_KEY],
): T {
  if (!fields || fields.length === 0 || data === null || data === undefined) {
    return data;
  }

  const allowedKeys = new Set<string>([...alwaysIncludeFields, ...fields]);
  const pickOne = (item: unknown): unknown => {
    if (typeof item !== 'object' || item === null || Array.isArray(item) || item instanceof Date) {
      return item;
    }
    const record = item as Record<string, unknown>;
    const picked: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      if (allowedKeys.has(key)) {
        picked[key] = record[key];
      }
    }
    return picked;
  };

  if (Array.isArray(data)) {
    return data.map((item) => pickOne(item)) as unknown as T;
  }
  return pickOne(data) as T;
}

export interface QueryComplexityCheckInput {
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly sortCriteriaCount?: number | undefined;
  readonly filterConditions?: readonly FilterCondition[] | undefined;
  readonly search?: string | undefined;
  readonly searchTokensCount?: number | undefined;
  readonly selectFieldsCount?: number | undefined;
}

export interface QueryComplexityLimits {
  readonly maxLimit?: number | undefined;
  readonly maxOffset?: number | undefined;
  readonly maxSortFields?: number | undefined;
  readonly maxFilterConditions?: number | undefined;
  readonly maxInValues?: number | undefined;
  readonly maxSearchLength?: number | undefined;
  readonly maxSearchTokens?: number | undefined;
  readonly maxSelectFields?: number | undefined;
}

/**
 * Kiểm tra tập trung độ phức tạp của một truy vấn danh sách (Mục 8.1 — Giới hạn độ phức tạp của query, tránh query quá nặng).
 * Ném `ValidationAppException` (400) nếu bất kỳ thông số nào vượt ngưỡng an toàn.
 */
export function assertQueryComplexity(
  input: QueryComplexityCheckInput,
  limits?: QueryComplexityLimits,
): void {
  const maxLimit = limits?.maxLimit ?? QUERY_COMPLEXITY_DEFAULTS.MAX_LIMIT;
  const maxOffset = limits?.maxOffset ?? QUERY_COMPLEXITY_DEFAULTS.MAX_OFFSET;
  const maxSortFields = limits?.maxSortFields ?? QUERY_COMPLEXITY_DEFAULTS.MAX_SORT_FIELDS;
  const maxFilterConditions =
    limits?.maxFilterConditions ?? QUERY_COMPLEXITY_DEFAULTS.MAX_FILTER_CONDITIONS;
  const maxInValues = limits?.maxInValues ?? QUERY_COMPLEXITY_DEFAULTS.MAX_IN_VALUES;
  const maxSearchLength = limits?.maxSearchLength ?? QUERY_COMPLEXITY_DEFAULTS.MAX_SEARCH_LENGTH;
  const maxSearchTokens = limits?.maxSearchTokens ?? QUERY_COMPLEXITY_DEFAULTS.MAX_SEARCH_TOKENS;
  const maxSelectFields = limits?.maxSelectFields ?? QUERY_COMPLEXITY_DEFAULTS.MAX_SELECT_FIELDS;

  if (input.limit !== undefined && input.limit > maxLimit) {
    throw new ValidationAppException([
      {
        field: 'limit',
        code: 'limit_exceeded',
        message: `Page size (${input.limit}) exceeds maximum allowed limit (${maxLimit})`,
      },
    ]);
  }

  if (input.offset !== undefined && input.offset > maxOffset) {
    throw new ValidationAppException([
      {
        field: 'page',
        code: 'offset_exceeded',
        message: `Offset (${input.offset}) exceeds maximum allowed offset (${maxOffset}). Use cursor pagination for deep datasets.`,
      },
    ]);
  }

  if (input.sortCriteriaCount !== undefined && input.sortCriteriaCount > maxSortFields) {
    throw new ValidationAppException([
      {
        field: 'sort',
        code: 'too_many_sort_fields',
        message: `Cannot sort by more than ${maxSortFields} fields`,
      },
    ]);
  }

  if (input.filterConditions !== undefined) {
    if (input.filterConditions.length > maxFilterConditions) {
      throw new ValidationAppException([
        {
          field: 'filter',
          code: 'too_many_filters',
          message: `Cannot apply more than ${maxFilterConditions} filter conditions`,
        },
      ]);
    }
    for (const cond of input.filterConditions) {
      if (
        (cond.operator === 'in' || cond.operator === 'nin') &&
        Array.isArray(cond.value) &&
        cond.value.length > maxInValues
      ) {
        throw new ValidationAppException([
          {
            field: cond.field,
            code: 'too_many_in_values',
            message: `Filter operator "${cond.operator}" on field "${cond.field}" cannot exceed ${maxInValues} values`,
          },
        ]);
      }
    }
  }

  if (input.search !== undefined && input.search.length > maxSearchLength) {
    throw new ValidationAppException([
      {
        field: 'search',
        code: 'search_too_long',
        message: `Search query must not exceed ${maxSearchLength} characters`,
      },
    ]);
  }

  if (input.searchTokensCount !== undefined && input.searchTokensCount > maxSearchTokens) {
    throw new ValidationAppException([
      {
        field: 'search',
        code: 'too_many_search_tokens',
        message: `Search query cannot exceed ${maxSearchTokens} tokens`,
      },
    ]);
  }

  if (input.selectFieldsCount !== undefined && input.selectFieldsCount > maxSelectFields) {
    throw new ValidationAppException([
      {
        field: 'fields',
        code: 'too_many_select_fields',
        message: `Cannot select more than ${maxSelectFields} fields`,
      },
    ]);
  }
}

/** Kết quả tổng hợp toàn diện của một truy vấn danh sách chuẩn. */
export interface ListQueryResult<
  TSortField extends string = string,
  TFilters = Record<string, unknown>,
  TFilterField extends string = string,
  TSelectField extends string = string,
> {
  readonly page: number;
  readonly limit: number;
  readonly offset: number;
  readonly cursor: string | null;
  readonly direction: CursorDirection;
  readonly countMode: CountMode;
  readonly sortBy: TSortField;
  readonly sortOrder: SortOrder;
  readonly sortCriteria: readonly SortCriterion<TSortField>[];
  readonly search: string | undefined;
  readonly advancedSearch: AdvancedSearchParsed<TFilterField> | undefined;
  readonly filterConditions: readonly FilterCondition<TFilterField>[];
  readonly dateRange?: ResolvedDateRange | undefined;
  readonly fields?: readonly TSelectField[] | undefined;
  readonly filters: TFilters;
}

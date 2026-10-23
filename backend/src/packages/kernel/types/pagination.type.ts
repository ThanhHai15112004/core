import type { SettingResolveContext } from '../contracts/setting-lookup.contract.js';
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
  /** Giá trị `limit` mặc định fallback khi chưa cấu hình (mặc định `PAGINATION_DEFAULTS.LIMIT = 20`). */
  readonly defaultLimit?: number | undefined;
  /** Giá trị `limit` tối đa fallback khi chưa cấu hình (mặc định `PAGINATION_DEFAULTS.MAX_LIMIT = 100`). */
  readonly maxLimit?: number | undefined;
  /** Giá trị `limit` tối thiểu (mặc định `PAGINATION_DEFAULTS.MIN_LIMIT = 1`). */
  readonly minLimit?: number | undefined;
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

  const defaultLimitKey =
    options?.defaultLimitKey ??
    (options?.settingPrefix ? `${options.settingPrefix}.default_page_size` : undefined);
  const maxLimitKey =
    options?.maxLimitKey ??
    (options?.settingPrefix ? `${options.settingPrefix}.max_page_size` : undefined);

  const fallbackDefault = options?.defaultLimit ?? globalDefaultLimit;
  const fallbackMax = options?.maxLimit ?? globalMaxLimit;

  const rawDefaultLimit = defaultLimitKey
    ? registry.getNumber(defaultLimitKey, ctx, fallbackDefault)
    : fallbackDefault;
  const rawMaxLimit = maxLimitKey ? registry.getNumber(maxLimitKey, ctx, fallbackMax) : fallbackMax;

  const minLimit = Math.max(1, Math.trunc(options?.minLimit ?? PAGINATION_DEFAULTS.MIN_LIMIT));
  const safeMaxLimit = Math.max(minLimit, Math.trunc(rawMaxLimit));
  const safeDefaultLimit = Math.min(safeMaxLimit, Math.max(minLimit, Math.trunc(rawDefaultLimit)));

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

/** Kết quả tổng hợp toàn diện của một truy vấn danh sách chuẩn. */
export interface ListQueryResult<
  TSortField extends string = string,
  TFilters = Record<string, unknown>,
  TFilterField extends string = string,
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
  readonly filters: TFilters;
}

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

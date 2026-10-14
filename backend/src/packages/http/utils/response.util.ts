import {
  type CountMode,
  type CursorPaginatedResult,
  type CursorPaginationMeta,
  type CursorPayload,
  PAGINATION_DEFAULTS,
  type PaginatedResult,
  type PaginationMeta,
  SORT_ORDERS,
  type SortOrder,
  ValidationAppException,
} from '@packages/kernel/index.js';

const CURSOR_ENCODING = 'base64url';
const TEXT_ENCODING = 'utf8';
const LOOKAHEAD_EXTRA_ROWS = 1;
const MIN_TOTAL_RECORDS = 0;

export interface OkEnvelopeInput<
  T,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly data: T;
  readonly meta?: TMeta;
}

/**
 * Đóng gói dữ liệu kèm `meta` tùy chọn để `TransformResponseInterceptor` bọc thành `ApiSuccessResponse`.
 */
export function okResponse<T, TMeta extends Record<string, unknown> = Record<string, unknown>>(
  data: T,
  meta?: TMeta,
): OkEnvelopeInput<T, TMeta> {
  return meta !== undefined ? { data, meta } : { data };
}

/**
 * Tính số lượng bản ghi cần lấy từ DB tùy theo chế độ đếm:
 * - Khi `countMode === 'none'` (tối ưu bảng lớn, bỏ qua `COUNT(*)`), lấy dư `limit + 1` dòng để xác định `hasNextPage`.
 * - Khi `countMode === 'exact'` hoặc `'estimated'`, lấy đúng `limit` dòng.
 */
export function getFetchLimitForCountMode(limit: number, countMode: CountMode = 'exact'): number {
  const safeLimit = Math.max(PAGINATION_DEFAULTS.MIN_LIMIT, limit);
  return countMode === 'none' ? safeLimit + LOOKAHEAD_EXTRA_ROWS : safeLimit;
}

/**
 * Tính toán metadata phân trang chuẩn (hỗ trợ cả chế độ có `total` và chế độ không đếm `total = null` cho bảng lớn).
 */
export function buildPaginationMeta(
  total: number | null,
  page: number = PAGINATION_DEFAULTS.PAGE,
  limit: number = PAGINATION_DEFAULTS.LIMIT,
  hasNextPageOverride?: boolean,
): PaginationMeta {
  const safePage = Math.max(PAGINATION_DEFAULTS.PAGE, Math.trunc(page));
  const safeLimit = Math.max(PAGINATION_DEFAULTS.MIN_LIMIT, Math.trunc(limit));

  if (total === null) {
    return {
      page: safePage,
      limit: safeLimit,
      total: null,
      totalPages: null,
      hasNextPage: Boolean(hasNextPageOverride),
      hasPrevPage: safePage > PAGINATION_DEFAULTS.PAGE,
    };
  }

  const safeTotal = Math.max(MIN_TOTAL_RECORDS, Math.trunc(total));
  const totalPages =
    safeTotal === MIN_TOTAL_RECORDS ? MIN_TOTAL_RECORDS : Math.ceil(safeTotal / safeLimit);
  const hasNextPage = hasNextPageOverride ?? safePage < totalPages;
  const hasPrevPage = safePage > PAGINATION_DEFAULTS.PAGE;

  return {
    page: safePage,
    limit: safeLimit,
    total: safeTotal,
    totalPages,
    hasNextPage,
    hasPrevPage,
  };
}

/**
 * Tạo kết quả phân trang chuẩn từ mảng dữ liệu và tổng số bản ghi (`PaginatedResult<T>`).
 * Tự động cắt bớt phần tử thứ `limit + 1` nếu truy vấn sử dụng kỹ thuật lookahead `limit + 1`.
 */
export function createPaginatedResult<T>(
  items: readonly T[],
  total: number | null,
  page: number = PAGINATION_DEFAULTS.PAGE,
  limit: number = PAGINATION_DEFAULTS.LIMIT,
): PaginatedResult<T> {
  const safeLimit = Math.max(PAGINATION_DEFAULTS.MIN_LIMIT, Math.trunc(limit));
  const hasLookaheadExtra = items.length > safeLimit;
  const data = hasLookaheadExtra ? items.slice(0, safeLimit) : items;
  const hasNextOverride = total === null ? hasLookaheadExtra : undefined;

  return {
    data,
    meta: buildPaginationMeta(total, page, safeLimit, hasNextOverride),
  };
}

/**
 * Mã hóa thông tin vị trí bản ghi (`sortValue` + `tieBreakerId`) thành chuỗi con trỏ Base64URL an toàn.
 * Phục vụ Keyset/Cursor Pagination hiệu năng $O(1)$ trên bảng dữ liệu lớn.
 */
export function encodeCursor<TValue = string | number | boolean | null>(
  payload: CursorPayload<TValue>,
): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json, TEXT_ENCODING).toString(CURSOR_ENCODING);
}

/**
 * Giải mã và xác thực tính toàn vẹn của chuỗi con trỏ phân trang.
 * Ném `ValidationAppException` (400) nếu con trỏ bị chỉnh sửa hoặc sai định dạng.
 */
export function decodeCursor<TValue = string | number | boolean | null>(
  cursorToken: string,
): CursorPayload<TValue> {
  try {
    const rawJson = Buffer.from(cursorToken, CURSOR_ENCODING).toString(TEXT_ENCODING);
    const parsed = JSON.parse(rawJson) as Record<string, unknown>;

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Invalid cursor object');
    }

    const tieBreakerId = parsed['tieBreakerId'];
    if (
      (typeof tieBreakerId !== 'string' && typeof tieBreakerId !== 'number') ||
      String(tieBreakerId).trim().length === 0
    ) {
      throw new Error('Missing tieBreakerId');
    }

    const sortValue = (parsed['sortValue'] ?? null) as TValue;
    const sortBy = typeof parsed['sortBy'] === 'string' ? parsed['sortBy'] : undefined;
    const rawSortOrder = parsed['sortOrder'];
    const sortOrder =
      typeof rawSortOrder === 'string' && (SORT_ORDERS as readonly string[]).includes(rawSortOrder)
        ? (rawSortOrder as SortOrder)
        : undefined;

    return {
      sortValue,
      tieBreakerId,
      ...(sortBy !== undefined ? { sortBy } : {}),
      ...(sortOrder !== undefined ? { sortOrder } : {}),
    };
  } catch {
    throw new ValidationAppException([
      {
        field: 'cursor',
        code: 'invalid_cursor',
        message: 'Invalid pagination cursor token',
      },
    ]);
  }
}

export interface CreateCursorPaginatedOptions<T> {
  /** Trích xuất `CursorPayload` (`sortValue`, `tieBreakerId`) từ một bản ghi. */
  readonly extractCursor: (item: T) => CursorPayload;
  /** Có trang trước đó hay không (thường là `Boolean(inputCursor)`). */
  readonly hasPrevPage?: boolean;
  /** Ghi đè `hasNextPage` nếu không dùng kỹ thuật lấy `limit + 1` dòng. */
  readonly hasNextPage?: boolean;
}

/**
 * Tạo kết quả phân trang theo con trỏ (`CursorPaginatedResult<T>`) tối ưu cho dữ liệu lớn.
 * Nếu truyền vào mảng `items` đã lấy theo `limit + 1`, hàm sẽ tự cắt về `limit` phần tử và bật `hasNextPage = true`.
 */
export function createCursorPaginatedResult<T>(
  items: readonly T[],
  limit: number = PAGINATION_DEFAULTS.LIMIT,
  options: CreateCursorPaginatedOptions<T>,
): CursorPaginatedResult<T> {
  const safeLimit = Math.max(PAGINATION_DEFAULTS.MIN_LIMIT, Math.trunc(limit));
  const hasLookaheadExtra = items.length > safeLimit;
  const data = hasLookaheadExtra ? items.slice(0, safeLimit) : items;

  const hasNextPage = options.hasNextPage ?? hasLookaheadExtra;
  const hasPrevPage = Boolean(options.hasPrevPage);

  const firstItem = data[0];
  const lastItem = data[data.length - 1];

  const nextCursor =
    hasNextPage && lastItem !== undefined ? encodeCursor(options.extractCursor(lastItem)) : null;
  const prevCursor =
    hasPrevPage && firstItem !== undefined ? encodeCursor(options.extractCursor(firstItem)) : null;

  const meta: CursorPaginationMeta = {
    limit: safeLimit,
    nextCursor,
    prevCursor,
    hasNextPage,
    hasPrevPage,
  };

  return {
    data,
    meta,
  };
}

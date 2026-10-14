export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string;
}

export type SortOrder = 'asc' | 'desc';

export type CursorDirection = 'next' | 'prev';

export type CountMode = 'exact' | 'estimated' | 'none';

export interface PaginationMeta extends Record<string, unknown> {
  page: number;
  limit: number;
  total: number | null;
  totalPages: number | null;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface CursorPaginationMeta extends Record<string, unknown> {
  limit: number;
  nextCursor: string | null;
  prevCursor: string | null;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface ListQueryParams {
  page?: number;
  limit?: number;
  cursor?: string;
  direction?: CursorDirection;
  countMode?: CountMode;
  sortBy?: string;
  sortOrder?: SortOrder;
  sort?: string;
  search?: string;
  q?: string;
  from?: string;
  to?: string;
}

/** Envelope thành công do `TransformResponseInterceptor` của backend bọc. */
export interface ApiResponse<T, TMeta = Record<string, unknown>> {
  success: true;
  statusCode: number;
  data: T;
  meta?: TMeta;
  timestamp: string;
}

export type PaginatedResponse<T> = ApiResponse<T[], PaginationMeta>;

export type CursorPaginatedResponse<T> = ApiResponse<T[], CursorPaginationMeta>;

export type ValidationSource = 'body' | 'query' | 'params';

export interface ApiErrorDetail {
  field?: string;
  message: string;
  code?: string;
  source?: ValidationSource;
}

/** Envelope lỗi do `GlobalExceptionFilter` của backend trả về. */
export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  error: { code: string; message: string; details?: unknown[] };
  timestamp: string;
}

import { frontendConfig } from '../../config/index';
import { getActiveLocale, getActiveTimezone } from '../i18n/index';
import type { ApiErrorResponse, ApiResponse } from '../types/index';

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function isEnvelope<T>(body: unknown): body is ApiResponse<T> {
  return typeof body === 'object' && body !== null && 'success' in body && 'data' in body;
}

function isErrorEnvelope(body: unknown): body is ApiErrorResponse {
  return typeof body === 'object' && body !== null && 'error' in body;
}

export interface PaginationMeta {
  readonly total?: number;
  readonly page?: number;
  readonly limit?: number;
  readonly totalPages?: number;
}

/**
 * Gọi backend API: tự gửi `Accept-Language` theo ngôn ngữ đang chọn,
 * chỉ gắn `Content-Type: application/json` khi có `body`,
 * áp dụng timeout, bóc envelope `{ success, data }` và ném `ApiError` khi lỗi.
 */
export async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const result = await fetchApiWithMeta<T>(endpoint, options);
  return result.data;
}

export const IAM_ACCESS_TOKEN_KEY = 'core_iam_access_token';
export const IAM_REFRESH_TOKEN_KEY = 'core_iam_refresh_token';

function getStoredAccessToken(): string | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(IAM_ACCESS_TOKEN_KEY) : null;
  } catch {
    return null;
  }
}

function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers;
}

/**
 * Gọi backend API và trả về cả `{ data, meta }` để phục vụ phân trang danh sách.
 */
export async function fetchApiWithMeta<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<{ data: T; meta?: PaginationMeta }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), frontendConfig.apiTimeoutMs);
  const hasBody = options.body !== undefined && options.body !== null;
  const accessToken = getStoredAccessToken();

  try {
    const response = await fetch(`${frontendConfig.apiBaseUrl}${endpoint}`, {
      ...options,
      signal: options.signal ?? controller.signal,
      headers: {
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        'Accept-Language': getActiveLocale(),
        'X-Timezone': getActiveTimezone(),
        ...normalizeHeaders(options.headers),
      },
    });

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message = isErrorEnvelope(body) ? body.error.message : response.statusText;
      const code = isErrorEnvelope(body) ? body.error.code : undefined;
      throw new ApiError(message, response.status, code);
    }

    if (isEnvelope<T>(body)) {
      const rawMeta = (body as unknown as { meta?: PaginationMeta }).meta;
      return {
        data: body.data,
        ...(rawMeta ? { meta: rawMeta } : {}),
      };
    }

    return { data: body as T };
  } finally {
    clearTimeout(timeoutId);
  }
}


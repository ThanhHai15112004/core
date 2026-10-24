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
export const IAM_AUTH_CHANGED_EVENT = 'core:iam-auth-changed';

const PUBLIC_ENDPOINT_PREFIXES = [
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/mfa/verify',
  '/auth/password/forgot',
  '/auth/password/reset',
  '/auth/password/suggest',
  '/auth/verify/email/confirm',
  '/auth/verify/phone/confirm',
  '/auth/api-clients/token',
  '/health',
  '/ops/',
] as const;

function isPublicEndpoint(endpoint: string): boolean {
  return PUBLIC_ENDPOINT_PREFIXES.some(
    (prefix) => endpoint === prefix || endpoint.startsWith(prefix),
  );
}

export function getStoredAccessToken(): string | null {
  try {
    const val =
      typeof window !== 'undefined' ? window.localStorage.getItem(IAM_ACCESS_TOKEN_KEY) : null;
    return val && val.trim().length > 0 ? val.trim() : null;
  } catch {
    return null;
  }
}

export function getStoredRefreshToken(): string | null {
  try {
    const val =
      typeof window !== 'undefined' ? window.localStorage.getItem(IAM_REFRESH_TOKEN_KEY) : null;
    return val && val.trim().length > 0 ? val.trim() : null;
  } catch {
    return null;
  }
}

export function setStoredAuthTokens(accessToken: string, refreshToken?: string): void {
  try {
    if (typeof window === 'undefined') return;
    const prevAccess = window.localStorage.getItem(IAM_ACCESS_TOKEN_KEY) ?? '';
    const prevRefresh = window.localStorage.getItem(IAM_REFRESH_TOKEN_KEY) ?? '';
    const nextAccess = accessToken.trim();

    if (nextAccess) {
      window.localStorage.setItem(IAM_ACCESS_TOKEN_KEY, nextAccess);
    } else {
      window.localStorage.removeItem(IAM_ACCESS_TOKEN_KEY);
    }

    let nextRefresh = prevRefresh;
    if (refreshToken !== undefined) {
      nextRefresh = refreshToken.trim();
      if (nextRefresh) {
        window.localStorage.setItem(IAM_REFRESH_TOKEN_KEY, nextRefresh);
      } else {
        window.localStorage.removeItem(IAM_REFRESH_TOKEN_KEY);
      }
    }

    if (prevAccess !== nextAccess || prevRefresh !== nextRefresh) {
      window.dispatchEvent(new CustomEvent(IAM_AUTH_CHANGED_EVENT));
    }
  } catch {
    // ignore storage errors
  }
}

export function clearStoredAuthTokens(): void {
  setStoredAuthTokens('', '');
}

let inFlightAuthPromise: Promise<string | null> | null = null;
let lastRefreshedAtMs = 0;

/**
 * Đảm bảo luôn có Access Token hợp lệ trước khi gọi API bảo vệ:
 * 1. Dùng lại token trong localStorage nếu còn.
 * 2. Nếu có Refresh Token, tự động xoay vòng qua `/auth/refresh`.
 * 3. Chống bão xoay vòng (Refresh Storm) khi nhiều request song song cùng gặp 401.
 */
export async function ensureAccessToken(
  forceRefresh = false,
  failedToken?: string | null,
): Promise<string | null> {
  const existing = getStoredAccessToken();
  if (!forceRefresh) {
    if (existing) return existing;
  } else if (existing) {
    // Nếu một request song song khác vừa làm mới token xong, dùng lại ngay thay vì gọi /auth/refresh lần nữa
    if (failedToken && existing !== failedToken) {
      return existing;
    }
    if (Date.now() - lastRefreshedAtMs < 2000) {
      return existing;
    }
  }

  if (inFlightAuthPromise) {
    return inFlightAuthPromise;
  }

  inFlightAuthPromise = (async (): Promise<string | null> => {
    const refreshController = new AbortController();
    const refreshTimeoutId = setTimeout(() => refreshController.abort(), 10000);
    try {
      const storedRefresh = getStoredRefreshToken();
      if (!storedRefresh) {
        if (existing) {
          clearStoredAuthTokens();
        }
        return null;
      }

      const refreshRes = await fetch(`${frontendConfig.apiBaseUrl}/auth/refresh`, {
        method: 'POST',
        signal: refreshController.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept-Language': getActiveLocale(),
          'X-Timezone': getActiveTimezone(),
        },
        body: JSON.stringify({ refreshToken: storedRefresh }),
      }).catch(() => null);

      if (refreshRes && refreshRes.ok) {
        const refreshBody: unknown = await refreshRes.json().catch(() => null);
        const payload = isEnvelope<{ accessToken?: string; refreshToken?: string }>(refreshBody)
          ? refreshBody.data
          : (refreshBody as { accessToken?: string; refreshToken?: string } | null);
        if (payload?.accessToken) {
          lastRefreshedAtMs = Date.now();
          setStoredAuthTokens(payload.accessToken, payload.refreshToken ?? storedRefresh);
          return payload.accessToken;
        }
      }

      // Nếu refresh token đã hết hạn hoặc bị thu hồi (401/403), xóa sạch khỏi localStorage để tránh lặp 401 vô tận
      if (refreshRes && (refreshRes.status === 401 || refreshRes.status === 403)) {
        clearStoredAuthTokens();
      }

      return null;
    } finally {
      clearTimeout(refreshTimeoutId);
      inFlightAuthPromise = null;
    }
  })();

  return inFlightAuthPromise;
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
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<{ data: T; meta?: PaginationMeta }> {
  const isUploadEndpoint =
    endpoint.includes('/files/upload') || endpoint.includes('/upload-chunked');
  const effectiveTimeoutMs =
    options.timeoutMs ??
    (isUploadEndpoint ? frontendConfig.uploadTimeoutMs : frontendConfig.apiTimeoutMs);
  const controller = new AbortController();
  let didTimeout = false;
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort(
      new ApiError(
        `Yêu cầu tới máy chủ quá thời gian chờ (${Math.round(effectiveTimeoutMs / 1000)}s). Vui lòng thử lại.`,
        408,
        'REQUEST_TIMEOUT',
      ),
    );
  }, effectiveTimeoutMs);
  const hasBody = options.body !== undefined && options.body !== null;
  const callerHeaders = normalizeHeaders(options.headers);
  const explicitAuth = callerHeaders['Authorization'] ?? callerHeaders['authorization'];
  const explicitToken = explicitAuth ? explicitAuth.replace(/^Bearer\s+/i, '').trim() : null;
  const isPublic = isPublicEndpoint(endpoint);

  let accessToken =
    explicitToken ||
    getStoredAccessToken() ||
    (isPublic ? null : await ensureAccessToken(false));

  const executeRequest = (tokenOverride?: string | null) => {
    const restCallerHeaders = { ...callerHeaders };
    delete restCallerHeaders['Authorization'];
    delete restCallerHeaders['authorization'];

    const nextHeaders: Record<string, string> = {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      'Accept-Language': getActiveLocale(),
      'X-Timezone': getActiveTimezone(),
      ...restCallerHeaders,
    };
    const effectiveToken = tokenOverride ?? accessToken;
    if (effectiveToken) {
      nextHeaders['Authorization'] = `Bearer ${effectiveToken}`;
    }
    return fetch(`${frontendConfig.apiBaseUrl}${endpoint}`, {
      ...options,
      signal: options.signal ?? controller.signal,
      headers: nextHeaders,
    });
  };

  try {
    let response = await executeRequest(accessToken);

    if (response.status === 401 && !isPublic) {
      const refreshedToken = await ensureAccessToken(true, accessToken);
      if (refreshedToken) {
        accessToken = refreshedToken;
        response = await executeRequest(refreshedToken);
      }
    }

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
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    const errName = err instanceof Error ? err.name : '';
    if (
      didTimeout ||
      errName === 'AbortError' ||
      /aborted without reason|The user aborted a request|signal is aborted/i.test(errMsg)
    ) {
      throw new ApiError(
        didTimeout
          ? `Yêu cầu tới máy chủ quá thời gian chờ (${Math.round(effectiveTimeoutMs / 1000)}s). Vui lòng thử lại.`
          : 'Yêu cầu kết nối đã bị ngắt hoặc quá thời gian chờ. Vui lòng thử lại.',
        408,
        'REQUEST_TIMEOUT',
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}


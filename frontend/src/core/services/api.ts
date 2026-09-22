import { frontendConfig } from '../../config/index';
import { getActiveLocale } from '../i18n/index';
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

/**
 * Gọi backend API: tự gửi `Accept-Language` theo ngôn ngữ đang chọn,
 * áp dụng timeout, bóc envelope `{ success, data }` và ném `ApiError` khi lỗi.
 */
export async function fetchApi<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), frontendConfig.apiTimeoutMs);

  try {
    const response = await fetch(`${frontendConfig.apiBaseUrl}${endpoint}`, {
      ...options,
      signal: options.signal ?? controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Accept-Language': getActiveLocale(),
        ...options.headers,
      },
    });

    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const message = isErrorEnvelope(body) ? body.error.message : response.statusText;
      const code = isErrorEnvelope(body) ? body.error.code : undefined;
      throw new ApiError(message, response.status, code);
    }

    return (isEnvelope<T>(body) ? body.data : body) as T;
  } finally {
    clearTimeout(timeoutId);
  }
}

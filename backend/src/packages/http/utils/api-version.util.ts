const PATH_SEPARATOR = '/';
const API_BASE_SEGMENT = 'api';

/**
 * Danh mục phiên bản API đang được hỗ trợ của hệ thống.
 */
export const API_VERSIONS = {
  V1: 'v1',
} as const;

export type ApiVersion = (typeof API_VERSIONS)[keyof typeof API_VERSIONS];

/** Tiền tố API mặc định (`api/v1`) khi không truyền tuỳ chỉnh. */
export const DEFAULT_API_PREFIX = `${API_BASE_SEGMENT}${PATH_SEPARATOR}${API_VERSIONS.V1}` as const;

/**
 * Chuẩn hóa chuỗi tiền tố API, loại bỏ dấu gạch chéo thừa ở đầu/cuối.
 * Ví dụ: `'/api/v1/'` -> `'api/v1'`
 */
export function normalizeApiPrefix(prefix: string): string {
  const trimmed = prefix.trim();
  let start = 0;
  let end = trimmed.length;

  while (start < end && trimmed[start] === PATH_SEPARATOR) {
    start++;
  }
  while (end > start && trimmed[end - 1] === PATH_SEPARATOR) {
    end--;
  }

  const normalized = trimmed.slice(start, end);
  return normalized.length > 0 ? normalized : DEFAULT_API_PREFIX;
}

/**
 * Xây dựng đường dẫn API đầy đủ có gắn tiền tố phiên bản (ví dụ: `'/api/v1/users'`).
 */
export function buildVersionedPath(
  routePath: string,
  apiPrefix: string = DEFAULT_API_PREFIX,
): string {
  const cleanPrefix = normalizeApiPrefix(apiPrefix);
  const trimmedRoute = routePath.trim();

  let start = 0;
  let end = trimmedRoute.length;
  while (start < end && trimmedRoute[start] === PATH_SEPARATOR) {
    start++;
  }
  while (end > start && trimmedRoute[end - 1] === PATH_SEPARATOR) {
    end--;
  }

  const cleanRoute = trimmedRoute.slice(start, end);
  if (cleanRoute.length === 0) {
    return `${PATH_SEPARATOR}${cleanPrefix}`;
  }
  return `${PATH_SEPARATOR}${cleanPrefix}${PATH_SEPARATOR}${cleanRoute}`;
}

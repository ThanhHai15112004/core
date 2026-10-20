/**
 * Phân tích chuỗi JSON an toàn, trả về `null` (hoặc `fallback`) nếu đầu vào rỗng hoặc không hợp lệ.
 */
export function safeJsonParse<T>(
  raw: string | null | undefined,
  fallback: T | null = null,
): T | null {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Phân tích mảng chuỗi JSON từ Redis/DB và lọc bỏ các phần tử lỗi (`null`).
 */
export function safeJsonParseList<T>(raws: readonly (string | null | undefined)[]): T[] {
  return raws.map((r) => safeJsonParse<T>(r)).filter((x): x is T => x !== null);
}

/**
 * Phân tích chuỗi JSON thành một Object phẳng (`Record<string, unknown>`), trả về `fallback` nếu lỗi.
 */
export function safeJsonParseObject<
  T extends Record<string, unknown> | null = Record<string, unknown> | null,
>(raw: string | null | undefined, fallback: T = null as T): T {
  if (!raw || !raw.trim()) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as T;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/**
 * Phân tích chuỗi JSON thành mảng chuỗi (`string[]`), tự động lọc và chuẩn hóa khoảng trắng.
 */
export function safeJsonParseStringArray(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => String(v).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

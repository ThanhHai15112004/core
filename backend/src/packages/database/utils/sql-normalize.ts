const MAX_SQL_LENGTH = 500;

/**
 * Chuẩn hoá SQL để lưu vào danh sách slow query: bỏ giá trị literal (chuỗi, số) để không lộ dữ liệu
 * và gom được các query cùng dạng; không bao giờ lưu params.
 */
export function normalizeSql(sql: string): string {
  const normalized = sql
    .replace(/'(?:[^']|'')*'/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.length > MAX_SQL_LENGTH
    ? `${normalized.slice(0, MAX_SQL_LENGTH)}…`
    : normalized;
}

/** Namespace của key không có dấu `:` (vd. `config`). */
export const ROOT_NAMESPACE = '(root)';
/** Namespace gộp khi vượt giới hạn số namespace theo dõi. */
export const OTHER_NAMESPACE = '(other)';

const ID_LIKE = [
  /^\d+$/, // 8291
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, // uuid
  /^[0-9a-f]{16,}$/i, // hash/hex dài
  /^[A-Za-z0-9_-]{20,}$/, // token/ULID/nanoid dài
  /^\d{1,3}(\.\d{1,3}){3}$/, // IPv4
  /^[0-9a-f]{0,4}(:[0-9a-f]{0,4}){2,}$/i, // IPv6
  /@/, // email
  /^\d{4}-\d{2}-\d{2}/, // ngày
];

/** Segment trông như định danh (id, uuid, hash, IP, email, ngày) → không thuộc tên namespace. */
export function isIdLike(segment: string): boolean {
  return segment === '' || ID_LIKE.some((re) => re.test(segment));
}

/**
 * Namespace của một key cache (không gồm prefix): lấy tối đa `depth` segment đầu, dừng ở segment trông như id
 * và luôn chừa lại segment cuối (phần định danh). `user:8291` → `user`, `data:users:12` → `data:users`,
 * `auth:session:ab12…` → `auth:session`, `config` → `(root)`.
 */
export function namespaceOf(key: string, depth = 2): string {
  const parts = key.split(':');
  if (parts.length < 2) return ROOT_NAMESPACE;
  const out: string[] = [];
  for (const part of parts.slice(0, Math.min(depth, parts.length - 1))) {
    if (isIdLike(part)) break;
    out.push(part);
  }
  return out.length ? out.join(':') : ROOT_NAMESPACE;
}

/** Key (không prefix) có thuộc namespace `ns` không. */
export function inNamespace(key: string, ns: string, depth = 2): boolean {
  return namespaceOf(key, depth) === ns;
}

/** Pattern SCAN (đã escape ký tự glob) cho mọi key bắt đầu bằng `ns:`. */
export function namespacePattern(dataPrefix: string, ns: string): string {
  const escape = (s: string) => s.replace(/[*?[\]\\]/g, '\\$&');
  return ns === ROOT_NAMESPACE ? `${escape(dataPrefix)}*` : `${escape(dataPrefix)}${escape(ns)}:*`;
}

/** Namespace có khớp danh sách cấu hình (khớp chính nó hoặc namespace con). */
export function matchesNamespace(ns: string, list: readonly string[]): boolean {
  return list.some((n) => ns === n || ns.startsWith(`${n}:`) || ns.split(':').includes(n));
}

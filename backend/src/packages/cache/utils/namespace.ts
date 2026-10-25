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
  /** Thoát các ký tự đặc biệt trong chuỗi để hiển thị an toàn */
  const escape = (s: string) => s.replace(/[*?[\]\\]/g, '\\$&');
  return ns === ROOT_NAMESPACE ? `${escape(dataPrefix)}*` : `${escape(dataPrefix)}${escape(ns)}:*`;
}

/** Namespace có khớp danh sách cấu hình (khớp chính nó hoặc namespace con). */
export function matchesNamespace(ns: string, list: readonly string[]): boolean {
  return list.some((n) => ns === n || ns.startsWith(`${n}:`) || ns.split(':').includes(n));
}

export interface StandardCacheKeyInput {
  project: string;
  environment: string;
  module: string;
  key: string;
}

export interface ParsedStandardCacheKey {
  project: string;
  environment: string;
  module: string;
  key: string;
}

/** Chuẩn hóa một thành phần định danh trong Cache Key (chữ thường, gọn, không chứa khoảng trắng). */
export function normalizeCacheSegment(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

/**
 * 7.5.2 — Chuẩn hóa tên Cache Key theo cấu trúc `<project>:<environment>:<module>:<key>`.
 * Nếu `key` đầu vào đã có tiền tố `<project>:<environment>:<module>:` thì không ghép lặp lại.
 */
export function buildStandardCacheKey(input: StandardCacheKeyInput): string {
  const project = normalizeCacheSegment(input.project, 'core');
  const environment = normalizeCacheSegment(input.environment, 'development');
  const moduleName = normalizeCacheSegment(input.module, 'common');
  const rawKey = input.key.trim().replace(/^:+|:+$/g, '');
  if (!rawKey) {
    throw new Error('Cache key suffix must not be empty');
  }
  const prefix = `${project}:${environment}:${moduleName}:`;
  if (rawKey.startsWith(prefix)) {
    return rawKey;
  }
  const modulePrefix = `${moduleName}:`;
  const normalizedSuffix = rawKey.startsWith(modulePrefix)
    ? rawKey.slice(modulePrefix.length)
    : rawKey;
  return `${prefix}${normalizedSuffix}`;
}

/** Phân tích một khóa đã chuẩn hóa theo cấu trúc `<project>:<environment>:<module>:<key>`. */
export function parseStandardCacheKey(scopedKey: string): ParsedStandardCacheKey | null {
  const parts = scopedKey.trim().split(':');
  if (parts.length < 4) return null;
  const [project, environment, moduleName, ...rest] = parts;
  if (!project || !environment || !moduleName || rest.length === 0) {
    return null;
  }
  return {
    project,
    environment,
    module: moduleName,
    key: rest.join(':'),
  };
}

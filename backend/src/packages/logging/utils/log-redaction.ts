import { isSensitiveKey } from '../redaction/redact.util.js';
import type { LogMetadata, LogMetadataValue } from '../contracts/log-sink.contract.js';

export const REDACTED = '[REDACTED]';

/**
 * Mẫu bí mật nằm lẫn trong chuỗi (message, stack, giá trị metadata): header Bearer/Basic, `password=…`, JWT, mật khẩu
 * trong URL kết nối. Che ngay khi ghi log — trước console và trước khi lưu — không phải ở frontend.
 */
const TEXT_PATTERNS: [RegExp, string][] = [
  [/\b(Bearer|Basic)\s+[A-Za-z0-9\-._~+/]+=*/g, `$1 ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${REDACTED}@`],
  [
    /\b(password|passwd|pwd|secret|client_?secret|token|access_?token|refresh_?token|api_?key|x-api-key|authorization|cookie|session_?id|private_?key|otp)("?\s*[=:]\s*)("?)(?!\[REDACTED|Bearer\b|Basic\b)[^\s"&,;]+\3/gi,
    `$1$2$3${REDACTED}$3`,
  ],
];

/** Tên các mẫu che trong chuỗi (hiển thị ở cấu hình). */
export const TEXT_REDACTION_PATTERNS = [
  'bearer/basic',
  'jwt',
  'url-credentials',
  'key=value',
] as const;

/** Kết quả che: chuỗi đã che và số chỗ bị che (để báo "redaction đang hoạt động"). */
export function redactText(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const [re, replacement] of TEXT_PATTERNS) {
    out = out.replace(re, (...args: unknown[]) => {
      count++;
      const groups = args.slice(1, -2) as (string | undefined)[];
      return replacement.replace(/\$(\d)/g, (_, i: string) => groups[Number(i) - 1] ?? '');
    });
  }
  return { text: out, count };
}

const MAX_DEPTH = 6;
const MAX_KEYS = 100;
const MAX_STRING = 4000;

/**
 * Chuẩn hoá metadata về JSON thuần (bỏ hàm, vòng lặp, giới hạn độ sâu / số key / độ dài chuỗi) và che field nhạy cảm
 * theo tên (`password`, `authorization`…) lẫn theo mẫu trong giá trị chuỗi.
 */
export function redactMetadata(input: unknown): { value: LogMetadata; count: number } {
  let count = 0;
  const seen = new WeakSet<object>();
  const walk = (value: unknown, depth: number): LogMetadataValue => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
      const r = redactText(value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value);
      count += r.count;
      return r.text;
    }
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (value instanceof Error) {
      const r = redactText(value.message);
      count += r.count;
      return { name: value.name, message: r.text };
    }
    if (typeof value !== 'object') return null;
    if (seen.has(value)) return '[Circular]';
    if (depth >= MAX_DEPTH) return '[Object]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map((v) => walk(v, depth + 1));
    const out: LogMetadata = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_KEYS)) {
      if (typeof v === 'function' || typeof v === 'symbol') continue;
      if (isSensitiveKey(k)) {
        out[k] = REDACTED;
        count++;
      } else out[k] = walk(v, depth + 1);
    }
    return out;
  };
  const value = walk(input, 0);
  return {
    value: value && typeof value === 'object' && !Array.isArray(value) ? value : { value },
    count,
  };
}

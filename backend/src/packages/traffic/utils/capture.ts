import { isSensitiveKey, redactSensitiveData } from '@packages/logging/index.js';
import type { CapturedBody } from '../contracts/traffic.types.js';

export const MASK = '••••••••';
const EMAIL = /^([^@\s])[^@\s]*(@[^@\s]+\.[^@\s]+)$/;

/** Header nhạy cảm (Authorization, Cookie, x-api-key…) chỉ giữ scheme, không bao giờ lộ giá trị. */
export function maskHeaders(
  headers: Record<string, string | string[] | number | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(headers)) {
    if (raw === undefined) continue;
    const value = Array.isArray(raw) ? raw.join(', ') : String(raw);
    if (!isSensitiveKey(name)) {
      out[name] = value;
      continue;
    }
    const scheme = /^(Bearer|Basic|Digest)\s/i.exec(value)?.[1];
    out[name] = scheme ? `${scheme} ${MASK}` : MASK;
  }
  return out;
}

/** `user@example.com` → `u***@example.com`. */
function maskEmails<T>(input: T): T {
  if (typeof input === 'string') return input.replace(EMAIL, '$1***$2') as T;
  if (Array.isArray(input)) return input.map((v: unknown) => maskEmails(v)) as T;
  if (input && typeof input === 'object') {
    return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).map(([k, v]) => [k, maskEmails(v)]),
    ) as T;
  }
  return input;
}

/** Redact theo tên field (dùng chung philosophy với log) + che email. */
export function redactPayload<T>(input: T): T {
  return maskEmails(redactSensitiveData(input));
}

const byteLength = (s: string) => Buffer.byteLength(s, 'utf8');

/**
 * Chuẩn hoá body để lưu: JSON được redact; text dài bị cắt; binary không lưu.
 * `raw` là object đã parse (request) hoặc payload chuỗi đã serialize (response).
 */
export function captureBody(
  raw: unknown,
  contentType: string | undefined,
  maxBytes: number,
  enabled: boolean,
): CapturedBody {
  if (!enabled) return { kind: 'none', truncated: false, omitted: 'disabled', sizeBytes: null };
  if (raw === undefined || raw === null || raw === '') {
    return { kind: 'none', truncated: false, omitted: 'empty', sizeBytes: 0 };
  }
  if (
    Buffer.isBuffer(raw) ||
    (typeof raw === 'object' && typeof (raw as { pipe?: unknown }).pipe === 'function')
  ) {
    return {
      kind: 'none',
      truncated: false,
      omitted: 'binary',
      sizeBytes: Buffer.isBuffer(raw) ? raw.length : null,
    };
  }

  let value: unknown = raw;
  if (typeof raw === 'string' && (contentType ?? '').includes('json')) {
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
  }

  if (typeof value === 'string') {
    const size = byteLength(value);
    return size > maxBytes
      ? { kind: 'text', value: value.slice(0, maxBytes), truncated: true, sizeBytes: size }
      : { kind: 'text', value, truncated: false, sizeBytes: size };
  }

  const redacted = redactPayload(value);
  const serialized = JSON.stringify(redacted) ?? '';
  const size = byteLength(serialized);
  if (size > maxBytes) {
    // Không lưu JSON cắt dở (không parse được); lưu bản xem trước dạng text đã redact.
    return { kind: 'text', value: serialized.slice(0, maxBytes), truncated: true, sizeBytes: size };
  }
  return { kind: 'json', value: redacted, truncated: false, sizeBytes: size };
}

/** IPv4 che octet cuối, IPv6 giữ 4 nhóm đầu. */
export function maskIp(ip: string | undefined): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return v4.replace(/\.\d+$/, '.x');
  const groups = ip.split(':');
  return groups.length > 4 ? `${groups.slice(0, 4).join(':')}:…` : ip;
}

/** Query string: redact theo tên tham số. */
export function redactQuery(query: unknown): Record<string, unknown> {
  if (!query || typeof query !== 'object') return {};
  return redactPayload({ ...(query as Record<string, unknown>) });
}

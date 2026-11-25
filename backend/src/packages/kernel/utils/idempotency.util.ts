import { createHash } from 'node:crypto';
import { IDEMPOTENCY_DEFAULTS } from '../contracts/idempotency.contract.js';

const MAX_CANONICAL_DEPTH = 16;
const MAX_REDACT_DEPTH = 10;

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'secret',
  'clientsecret',
  'clientsecrethash',
  'signingsecret',
  'encryptedsecret',
  'totpsecret',
  'recoverycodes',
  'recoverycodeshashjson',
  'token',
  'accesstoken',
  'refreshtoken',
  'refreshtokenhash',
  'authorization',
  'apikey',
  'privatekey',
  'emailotpcodehash',
  'smsotpcodehash',
  'codehash',
]);

/**
 * Chuẩn hóa đệ quy giá trị JS thành dạng JSON xác định (sắp xếp key tăng dần, bỏ `undefined`,
 * xử lý `Date`/`Buffer`/`BigInt`/vòng tham chiếu) để băm SHA-256 nhất quán bất kể thứ tự key.
 */
export function canonicalizeIdempotencyValue(
  value: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (value === null || value === undefined) return null;
  if (depth > MAX_CANONICAL_DEPTH) return '[MAX_DEPTH]';

  const valueType = typeof value;
  if (valueType === 'bigint') return (value as bigint).toString();
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (Buffer.isBuffer(value)) {
    return `base64:${value.toString('base64')}`;
  }
  if (value instanceof Uint8Array) {
    return `base64:${Buffer.from(value).toString('base64')}`;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    const normalized = value.map((item) => canonicalizeIdempotencyValue(item, depth + 1, seen));
    seen.delete(value);
    return normalized;
  }
  if (valueType === 'object') {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) return '[CIRCULAR]';
    seen.add(obj);
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      const val = obj[key];
      if (val !== undefined && typeof val !== 'function' && typeof val !== 'symbol') {
        sorted[key] = canonicalizeIdempotencyValue(val, depth + 1, seen);
      }
    }
    seen.delete(obj);
    return sorted;
  }

  return String(value);
}

/**
 * Tính dấu vân tay SHA-256 (hex 64 ký tự) từ dữ liệu đầu vào bất kỳ sau khi chuẩn hóa canonical JSON.
 * Dùng chung cho API request, Background Job payload, Webhook payload và Domain Event payload.
 */
export function computeIdempotencyFingerprint(payload: unknown): string {
  const canonical = canonicalizeIdempotencyValue(payload);
  const serialized = JSON.stringify(canonical) ?? 'null';
  return createHash('sha256').update(serialized, 'utf8').digest('hex');
}

/**
 * Chuẩn hóa và kiểm định sơ bộ Idempotency Key (chỉ nhận ký tự in được, không chứa control char, giới hạn độ dài).
 * Trả về `null` nếu rỗng hoặc không hợp lệ.
 */
export function normalizeIdempotencyKey(
  rawKey: string | null | undefined,
  maxLength: number = IDEMPOTENCY_DEFAULTS.MAX_KEY_LENGTH,
): string | null {
  if (typeof rawKey !== 'string') return null;
  const trimmed = rawKey.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  // Chặn ký tự điều khiển ASCII (0x00..0x1F, 0x7F)
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return null;
    }
  }
  return trimmed;
}

/** Chuẩn hóa tên mục tiêu của luồng chống trùng (`scopeTarget`: route, topic, providerCode, handlerId). */
export function normalizeIdempotencyScopeTarget(
  rawTarget: string | null | undefined,
  fallback = 'default',
): string {
  const cleaned = typeof rawTarget === 'string' ? rawTarget.trim() : '';
  const resolved = cleaned || fallback;
  return resolved.slice(0, IDEMPOTENCY_DEFAULTS.MAX_SCOPE_TARGET_LENGTH);
}

/** Che giấu đệ quy các trường nhạy cảm trước khi lưu bản sao phản hồi replay vào DB. */
export function redactIdempotencyResponsePayload(
  data: unknown,
  depth = 0,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (data === null || data === undefined || depth > MAX_REDACT_DEPTH) {
    return data === undefined ? null : data;
  }
  if (typeof data === 'bigint') return data.toString();
  if (data instanceof Date) return data.toISOString();
  if (Buffer.isBuffer(data)) return '[BINARY_BUFFER]';
  if (Array.isArray(data)) {
    if (seen.has(data)) return '[CIRCULAR]';
    seen.add(data);
    const out = data.map((item) => redactIdempotencyResponsePayload(item, depth + 1, seen));
    seen.delete(data);
    return out;
  }
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if (seen.has(obj)) return '[CIRCULAR]';
    seen.add(obj);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
      if (SENSITIVE_KEYS.has(k.toLowerCase())) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactIdempotencyResponsePayload(v, depth + 1, seen);
      }
    }
    seen.delete(obj);
    return out;
  }
  return data;
}

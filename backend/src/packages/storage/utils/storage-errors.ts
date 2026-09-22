import type { StorageErrorKind } from '../contracts/storage-events.types.js';

const MAX_MESSAGE = 300;

interface ErrorLike {
  name?: unknown;
  code?: unknown;
  Code?: unknown;
  message?: unknown;
  $metadata?: { httpStatusCode?: number };
}

/** Mã lỗi provider: S3 (`name`/`Code`: NoSuchKey, AccessDenied…) hoặc Node fs (`code`: ENOENT…). */
export function storageErrorCode(err: unknown): string | null {
  const e = err as ErrorLike | null;
  for (const v of [e?.code, e?.Code, e?.name]) {
    if (typeof v === 'string' && v && v !== 'Error') return v;
  }
  return null;
}

export const storageHttpStatus = (err: unknown): number | null =>
  (err as ErrorLike | null)?.$metadata?.httpStatusCode ?? null;

const NOT_FOUND = new Set(['ENOENT', 'NoSuchKey', 'NotFound', 'NoSuchBucket', 'NoSuchVersion']);
const PERMISSION = new Set([
  'EACCES',
  'EPERM',
  'AccessDenied',
  'Forbidden',
  'InvalidAccessKeyId',
  'SignatureDoesNotMatch',
  'AllAccessDisabled',
]);
const TIMEOUT = new Set(['ETIMEDOUT', 'RequestTimeout', 'TimeoutError', 'RequestTimeTooSkewed']);
const CONNECTION = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'EAI_AGAIN',
  'NetworkingError',
]);
const NO_SPACE = new Set(['ENOSPC', 'EDQUOT', 'XMinioStorageFull', 'EntityTooLarge']);
const THROTTLED = new Set(['SlowDown', 'Throttling', 'TooManyRequests', 'ServiceUnavailable']);

export function classifyStorageError(err: unknown): StorageErrorKind {
  const code = storageErrorCode(err) ?? '';
  const status = storageHttpStatus(err);
  if (NOT_FOUND.has(code) || status === 404) return 'not_found';
  if (PERMISSION.has(code) || status === 403) return 'permission';
  if (NO_SPACE.has(code)) return 'no_space';
  if (THROTTLED.has(code) || status === 503 || status === 429) return 'throttled';
  if (TIMEOUT.has(code)) return 'timeout';
  if (
    CONNECTION.has(code) ||
    /ECONNREFUSED|socket hang up|connect/i.test(String((err as ErrorLike)?.message ?? ''))
  )
    return 'connection';
  return 'other';
}

/** Message an toàn để lưu (không có đường dẫn tuyệt đối của máy chủ, cắt ngắn). */
export function sanitizeStorageMessage(err: unknown, root?: string): string {
  let raw = err instanceof Error ? err.message : String(err);
  if (root) raw = raw.split(root).join('<root>');
  const clean = raw.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_MESSAGE ? `${clean.slice(0, MAX_MESSAGE)}…` : clean;
}

/** Lỗi có chủ đích của storage (không tìm thấy, key không hợp lệ…) để tầng trên dịch message. */
export class StorageObjectError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'INVALID_KEY' | 'UNSUPPORTED',
    message: string,
  ) {
    super(message);
  }
}

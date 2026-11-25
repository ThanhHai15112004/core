import {
  clampRetryCount,
  computeResilienceBackoffMs,
  sleepWithAbortSignal,
} from '@packages/kernel/index.js';
import type { DbErrorKind } from '../contracts/database-events.types.js';

const MAX_MESSAGE = 300;
export const DB_MAX_RETRIES_CAP = 5;

const DEADLOCK = new Set(['ER_LOCK_DEADLOCK', '1213', '40P01']);
const LOCK_TIMEOUT = new Set(['ER_LOCK_WAIT_TIMEOUT', '1205', '55P03']);
const TIMEOUT = new Set([
  'ETIMEDOUT',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'ER_QUERY_TIMEOUT',
  'ER_TRANSACTION_TIMEOUT',
  '3024',
  'ETIMEOUT',
]);
const CANCELLED = new Set(['ER_QUERY_INTERRUPTED', '1317', '57014']);
const UNIQUE_VIOLATION = new Set([
  'ER_DUP_ENTRY',
  '1062',
  '23505',
  '2601',
  '2627',
  'SQLITE_CONSTRAINT_UNIQUE',
  '2067',
]);
const FOREIGN_KEY_VIOLATION = new Set([
  'ER_NO_REFERENCED_ROW',
  'ER_NO_REFERENCED_ROW_2',
  'ER_ROW_IS_REFERENCED',
  'ER_ROW_IS_REFERENCED_2',
  '1216',
  '1217',
  '1451',
  '1452',
  '23503',
  '547',
  'SQLITE_CONSTRAINT_FOREIGNKEY',
  '787',
]);
const CONNECTION = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
  'ER_CON_COUNT_ERROR',
  'ER_ACCESS_DENIED_ERROR',
  '57P01',
  '53300',
]);

/** Mã lỗi driver (mysql2: `code`/`errno`, pg: `code` SQLSTATE, Node: `code`). */
export function errorCodeOf(err: unknown): string | null {
  const e = err as { code?: unknown; errno?: unknown; driverError?: unknown } | null;
  const source = (e?.driverError as typeof e) ?? e;
  if (typeof source?.code === 'string' || typeof source?.code === 'number')
    return String(source.code);
  if (typeof source?.errno === 'number') return String(source.errno);
  return null;
}

/** Kiểm tra lỗi có phải do vi phạm ràng buộc duy nhất (Unique Constraint) hay không */
export function isUniqueConstraintError(err: unknown): boolean {
  const code = errorCodeOf(err);
  const errno = String(
    (err as { errno?: unknown; driverError?: { errno?: unknown } })?.driverError?.errno ??
      (err as { errno?: unknown })?.errno ??
      '',
  );
  if ((code !== null && UNIQUE_VIOLATION.has(code)) || UNIQUE_VIOLATION.has(errno)) {
    return true;
  }
  const message = err instanceof Error ? err.message : '';
  return (
    message.includes('Duplicate entry') ||
    message.includes('duplicate key value violates unique constraint') ||
    message.includes('UNIQUE constraint failed')
  );
}

/** Kiểm tra lỗi có phải do vi phạm khóa ngoại (Foreign Key Constraint) hay không */
export function isForeignKeyConstraintError(err: unknown): boolean {
  const code = errorCodeOf(err);
  const errno = String(
    (err as { errno?: unknown; driverError?: { errno?: unknown } })?.driverError?.errno ??
      (err as { errno?: unknown })?.errno ??
      '',
  );
  return (code !== null && FOREIGN_KEY_VIOLATION.has(code)) || FOREIGN_KEY_VIOLATION.has(errno);
}

/** Phân loại mã lỗi cơ sở dữ liệu thành các nhóm lỗi nghiệp vụ chuẩn */
export function classifyDbError(err: unknown): DbErrorKind {
  const code = errorCodeOf(err);
  const errno = String(
    (err as { errno?: unknown; driverError?: { errno?: unknown } })?.driverError?.errno ??
      (err as { errno?: unknown })?.errno ??
      '',
  );
  /** Kiểm tra sự tồn tại của một khóa trong bộ lưu trữ */
  const has = (set: Set<string>) => (code !== null && set.has(code)) || set.has(errno);
  if (has(DEADLOCK)) return 'deadlock';
  if (has(LOCK_TIMEOUT)) return 'lock_timeout';
  if (has(CANCELLED)) return 'cancelled';
  if (has(TIMEOUT)) return 'timeout';
  if (isUniqueConstraintError(err)) return 'unique_violation';
  if (isForeignKeyConstraintError(err)) return 'foreign_key_violation';
  if (has(CONNECTION) || (code !== null && code.startsWith('08'))) return 'connection';
  return 'query';
}

/** Message lỗi an toàn để lưu: bỏ literal trong dấu nháy (vd. "Duplicate entry 'a@b.c'"), cắt ngắn. */
export function sanitizeDbMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const clean = raw
    .replace(/'(?:[^'\\]|\\.)*'/g, "'?'")
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > MAX_MESSAGE ? `${clean.slice(0, MAX_MESSAGE)}…` : clean;
}

const NON_TRANSIENT_CONNECTION_CODES = new Set([
  'ER_ACCESS_DENIED_ERROR',
  '1045',
  '28P01',
  '28000',
]);

/**
 * Kiểm tra lỗi DB có phải lỗi tạm thời (deadlock, lock_timeout, rớt kết nối tạm thời) để được phép retry hay không.
 * Tuyệt đối KHÔNG retry lỗi ràng buộc (unique/FK), lỗi cú pháp SQL, lỗi phân quyền hay thao tác bị hủy.
 */
export function isTransientDbError(err: unknown, includeTimeout = false): boolean {
  const code = errorCodeOf(err);
  if (code !== null && NON_TRANSIENT_CONNECTION_CODES.has(code)) {
    return false;
  }
  const kind = classifyDbError(err);
  if (kind === 'deadlock' || kind === 'lock_timeout' || kind === 'connection') {
    return true;
  }
  return includeTimeout && kind === 'timeout';
}

export interface DbRetryOptions {
  readonly maxRetries?: number | undefined;
  readonly baseDelayMs?: number | undefined;
  readonly maxDelayMs?: number | undefined;
  readonly jitter?: boolean | undefined;
  readonly includeTimeout?: boolean | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly randomFn?: (() => number) | undefined;
  readonly onRetry?:
    | ((info: { attempt: number; delayMs: number; kind: DbErrorKind; error: unknown }) => void)
    | undefined;
}

/**
 * Thực thi thao tác DB có retry giới hạn (chặn trần `DB_MAX_RETRIES_CAP`) cho lỗi tạm thời
 * kèm exponential backoff + jitter.
 */
export async function withDbRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: DbRetryOptions = {},
): Promise<T> {
  const maxRetries = clampRetryCount(options.maxRetries ?? 2, DB_MAX_RETRIES_CAP);
  const baseDelayMs = Math.max(10, Math.round(options.baseDelayMs ?? 100));
  const maxDelayMs = Math.max(baseDelayMs, Math.round(options.maxDelayMs ?? 2_000));
  const jitter = options.jitter ?? true;
  const maxAttempts = 1 + maxRetries;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (err) {
      const canRetry =
        attempt < maxAttempts && isTransientDbError(err, options.includeTimeout ?? false);
      if (!canRetry) {
        throw err;
      }
      const delayMs = computeResilienceBackoffMs(
        attempt,
        { baseDelayMs, maxDelayMs, jitter, strategy: 'exponential', respectRetryAfter: false },
        options.randomFn,
      );
      options.onRetry?.({
        attempt,
        delayMs,
        kind: classifyDbError(err),
        error: err,
      });
      await sleepWithAbortSignal(delayMs, options.signal);
    }
  }

  // Unreachable because loop always returns or throws on final attempt
  throw new Error('DB retry loop exited unexpectedly');
}

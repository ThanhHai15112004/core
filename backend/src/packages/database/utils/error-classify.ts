import type { DbErrorKind } from '../contracts/database-events.types.js';

const MAX_MESSAGE = 300;

const DEADLOCK = new Set(['ER_LOCK_DEADLOCK', '1213', '40P01']);
const LOCK_TIMEOUT = new Set(['ER_LOCK_WAIT_TIMEOUT', '1205', '55P03']);
const TIMEOUT = new Set([
  'ETIMEDOUT',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'ER_QUERY_TIMEOUT',
  '3024',
  'ETIMEOUT',
]);
const CANCELLED = new Set(['ER_QUERY_INTERRUPTED', '1317', '57014']);
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

export function classifyDbError(err: unknown): DbErrorKind {
  const code = errorCodeOf(err);
  const errno = String(
    (err as { errno?: unknown; driverError?: { errno?: unknown } })?.driverError?.errno ??
      (err as { errno?: unknown })?.errno ??
      '',
  );
  const has = (set: Set<string>) => (code !== null && set.has(code)) || set.has(errno);
  if (has(DEADLOCK)) return 'deadlock';
  if (has(LOCK_TIMEOUT)) return 'lock_timeout';
  if (has(CANCELLED)) return 'cancelled';
  if (has(TIMEOUT)) return 'timeout';
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

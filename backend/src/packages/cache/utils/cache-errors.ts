import type { CacheErrorKind } from '../contracts/cache-events.types.js';

const MAX_MESSAGE = 300;

/** Phân loại lỗi ioredis / serialize. */
export function classifyCacheError(err: unknown): CacheErrorKind {
  const e = err as { code?: unknown; name?: unknown; message?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  const message = typeof e?.message === 'string' ? e.message : String(err);
  if (err instanceof SyntaxError || e?.name === 'TypeError') return 'serialization';
  if (/^OOM\b/.test(message)) return 'oom';
  if (code === 'ETIMEDOUT' || /timed? ?out/i.test(message)) return 'timeout';
  if (
    ['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENOTFOUND', 'EPIPE'].includes(code) ||
    /Connection is closed|Stream isn't writeable|enableOfflineQueue|MaxRetriesPerRequest/i.test(
      message,
    )
  )
    return 'connection';
  return 'command';
}

/** Message an toàn để lưu (bỏ literal trong nháy, cắt ngắn). */
export function sanitizeCacheMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const clean = raw
    .replace(/'(?:[^'\\]|\\.)*'/g, "'?'")
    .replace(/"(?:[^"\\]|\\.)*"/g, '"?"')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > MAX_MESSAGE ? `${clean.slice(0, MAX_MESSAGE)}…` : clean;
}

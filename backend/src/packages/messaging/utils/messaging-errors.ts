import type { MessagingErrorKind } from '../contracts/messaging-events.types.js';

const MAX_MESSAGE = 300;

interface ErrorLike {
  name?: unknown;
  code?: unknown;
  message?: unknown;
}

/** Envelope sai cấu trúc — consumer không đọc được (không retry). */
export class MessageDeserializeError extends Error {
  public override readonly name = 'MessageDeserializeError';
}

export function messagingErrorCode(err: unknown): string | null {
  const e = err as ErrorLike | null;
  for (const v of [e?.code, e?.name]) {
    if (typeof v === 'string' && v && v !== 'Error') return v;
  }
  return null;
}

const CONNECTION = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'EAI_AGAIN',
  'NR_CLOSED',
]);
const TIMEOUT = new Set(['ETIMEDOUT', 'TimeoutError', 'AbortError']);

export function classifyMessagingError(
  err: unknown,
  stage: 'publish' | 'consume',
): MessagingErrorKind {
  if (err instanceof MessageDeserializeError) return 'deserialize';
  const code = messagingErrorCode(err) ?? '';
  const message = String((err as ErrorLike | null)?.message ?? '');
  if (/stalled/i.test(message)) return 'stalled';
  if (CONNECTION.has(code) || /ECONNREFUSED|Connection is closed|connect ETIMEDOUT/i.test(message))
    return 'connection';
  if (TIMEOUT.has(code) || /timed? ?out/i.test(message)) return 'timeout';
  if (stage === 'publish') return 'publish';
  if (/JSON|Unexpected token|deserializ/i.test(message)) return 'deserialize';
  return 'processing';
}

/** Message an toàn để lưu (một dòng, cắt ngắn). */
export function sanitizeMessagingMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const clean = raw.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_MESSAGE ? `${clean.slice(0, MAX_MESSAGE)}…` : clean;
}

/** Message không tồn tại / không ở trạng thái cho phép thao tác — tầng trên dịch thành lỗi HTTP. */
export class MessageStateError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'INVALID_STATE',
    public readonly state: string | null = null,
  ) {
    super(code === 'NOT_FOUND' ? 'Message not found' : `Message is ${state ?? 'unknown'}`);
  }
}

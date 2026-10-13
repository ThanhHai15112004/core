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

/** Xác định mã lỗi chuẩn cho sự cố truyền tin */
export function messagingErrorCode(err: unknown): string | null {
  const e = err as ErrorLike | null;
  for (const v of [e?.code, e?.name]) {
    if (typeof v === 'string' && v && v !== 'Error') return v;
  }
  return null;
}

/** Loại lỗi suy ra từ `failedReason` của job (BullMQ chỉ giữ message, không giữ code). */
export function errorKindOf(message: string): MessagingErrorKind {
  if (/stalled/i.test(message)) return 'stalled';
  if (
    /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENOTFOUND|EPIPE|EAI_AGAIN|NR_CLOSED|Connection is closed/.test(
      message,
    )
  )
    return 'connection';
  if (/timed? ?out|ETIMEDOUT|TimeoutError|AbortError/i.test(message)) return 'timeout';
  if (/Malformed envelope|MessageDeserializeError|JSON|Unexpected token|deserializ/i.test(message))
    return 'deserialize';
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

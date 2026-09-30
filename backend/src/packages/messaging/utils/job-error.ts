import { UnrecoverableError } from 'bullmq';
import { MessageDeserializeError, sanitizeMessagingMessage } from './messaging-errors.js';

/** Hệ thống phụ thuộc gây lỗi — chỉ khi có bằng chứng (processor khai báo hoặc tên lỗi / message nói rõ). */
export type JobDependency = 'database' | 'cache' | 'storage' | 'messaging' | 'http';

export const JOB_CANCELLED = 'JobCancelled';

/**
 * Lỗi nghiệp vụ của job có phân loại: `type` để gộp nhóm, `retryable` để worker không retry vô ích (và Console
 * tắt nút Retry), `dependency` để trỏ sang trang hạ tầng liên quan. Message dạng `Type: message`.
 */
export class JobError extends Error {
  public readonly type: string;
  public readonly retryable: boolean | null;
  public readonly dependency: JobDependency | null;

  constructor(
    type: string,
    message: string,
    opts: { retryable?: boolean | null; dependency?: JobDependency | null; cause?: unknown } = {},
  ) {
    super(`${type}: ${message}`, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = type;
    this.type = type;
    this.retryable = opts.retryable ?? null;
    this.dependency = opts.dependency ?? null;
  }
}

export interface JobErrorInfo {
  type: string;
  message: string;
  /** null = không rõ (worker vẫn retry theo cấu hình). */
  retryable: boolean | null;
  dependency: JobDependency | null;
}

/** Loại lỗi coi như không retry được dù không phải JobError. */
const NON_RETRYABLE = new Set([
  'ValidationError',
  'ZodError',
  'MessageDeserializeError',
  'UnrecoverableError',
  JOB_CANCELLED,
]);
const CONNECTION = /^(ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENOTFOUND|EPIPE|EAI_AGAIN|NR_CLOSED)$/;
const HEAD =
  /^([A-Z][A-Za-z0-9_]*(?:Error|Exception|Timeout|Failure|Fault|Cancelled|Unavailable))\b/;

/** `StorageTimeout: bucket…` → `StorageTimeout`; không nhận ra → null. */
export function errorTypeOf(message: string | null | undefined): string | null {
  const raw = (message ?? '').trim();
  const head = HEAD.exec(raw);
  if (head) return head[1]!;
  const code = /^([A-Z][A-Z0-9_]{2,})\b/.exec(raw);
  return code ? code[1]! : null;
}

export function isRetryableType(type: string | null): boolean | null {
  if (!type) return null;
  return NON_RETRYABLE.has(type) ? false : null;
}

const DEPENDENCY: [JobDependency, RegExp, RegExp][] = [
  [
    'database',
    /\b(mysql|mariadb|postgres|sql|prisma|typeorm|database|deadlock)/i,
    /Database|Db[A-Z]|Sql[A-Z]/,
  ],
  ['storage', /\b(s3|minio|bucket|storage)\b/i, /Storage/],
  ['cache', /\b(redis|ioredis|cache)\b/i, /Cache|Redis/],
  ['messaging', /\b(bullmq|broker)\b/i, /Queue[A-Z]|Broker/],
  ['http', /\b(fetch failed|axios|status code \d{3})/i, /Http[A-Z]|HTTP/],
];

/** Hệ phụ thuộc suy ra từ tên lỗi / message — chỉ khi có từ khoá rõ ràng. */
export function dependencyOf(text: string): JobDependency | null {
  for (const [dep, words, names] of DEPENDENCY)
    if (words.test(text) || names.test(text)) return dep;
  return null;
}

export function classifyJobError(err: unknown): JobErrorInfo {
  const message = sanitizeMessagingMessage(err);
  if (err instanceof JobError)
    return {
      type: err.type,
      message,
      retryable: err.retryable,
      dependency: err.dependency ?? dependencyOf(err.type),
    };
  if (err instanceof MessageDeserializeError)
    return { type: 'MessageDeserializeError', message, retryable: false, dependency: null };
  const e = err as { name?: unknown; code?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  const name = typeof e?.name === 'string' && e.name !== 'Error' ? e.name : '';
  if (err instanceof UnrecoverableError)
    return {
      type: errorTypeOf(message) ?? 'UnrecoverableError',
      message,
      retryable: false,
      dependency: dependencyOf(message),
    };
  if (CONNECTION.test(code))
    return {
      type: 'DependencyUnavailable',
      message,
      retryable: true,
      dependency: dependencyOf(message),
    };
  if (code === 'ETIMEDOUT' || name === 'TimeoutError' || /timed? ?out/i.test(message))
    return {
      type: name && name !== 'TimeoutError' ? name : (errorTypeOf(message) ?? 'Timeout'),
      message,
      retryable: true,
      dependency: dependencyOf(`${name} ${message}`),
    };
  const type = name || errorTypeOf(message) || 'UnhandledException';
  return {
    type,
    message,
    retryable: isRetryableType(type),
    dependency: dependencyOf(`${type} ${message}`),
  };
}

/** Lỗi không retry được → `UnrecoverableError` (BullMQ đưa thẳng vào failed), giữ message `Type: …` và stack. */
export function toUnrecoverable(err: unknown, info: JobErrorInfo): UnrecoverableError {
  const text = info.message.startsWith(`${info.type}:`)
    ? info.message
    : `${info.type}: ${info.message}`;
  const u = new UnrecoverableError(text);
  if (err instanceof Error && err.stack) u.stack = err.stack;
  return u;
}

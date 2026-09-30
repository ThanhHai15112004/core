import type { ExecutionError } from '../contracts/scheduler.types.js';

const MAX_MESSAGE = 500;

/**
 * Lỗi có loại rõ ràng mà task có thể ném để trang Scheduler gộp nhóm đúng, vd.
 * `throw new TaskError('StorageTimeout', 'Unable to upload generated report')`.
 */
export class TaskError extends Error {
  constructor(
    public readonly type: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = type;
  }
}

/** Lỗi kết nối tới dịch vụ phụ thuộc (DB, Redis, HTTP…) — gộp chung một loại. */
const DEPENDENCY_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'EPIPE',
]);

/** Bỏ thông tin đăng nhập trong URL và cắt ngắn. */
export function sanitizeTaskMessage(message: string): string {
  const clean = message
    .replace(/\/\/[^/\s:@]+:[^/\s@]+@/g, '//***@')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > MAX_MESSAGE ? `${clean.slice(0, MAX_MESSAGE)}…` : clean;
}

/** Chuẩn hoá lỗi thành loại + message để hiển thị và gộp nhóm (StorageTimeout, DependencyUnavailable…). */
export function classifyTaskError(err: unknown): ExecutionError {
  if (err instanceof TaskError)
    return { type: err.type, message: sanitizeTaskMessage(err.message) };
  if (!(err instanceof Error))
    return { type: 'UnhandledException', message: sanitizeTaskMessage(String(err)) };
  const message = sanitizeTaskMessage(err.message || err.name);
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && DEPENDENCY_CODES.has(code))
    return { type: 'DependencyUnavailable', message };
  if (err.name && err.name !== 'Error') return { type: err.name, message };
  const head = /^([A-Z][A-Za-z0-9]*(?:Error|Exception|Timeout|Failure|Unavailable))\b/.exec(
    message,
  );
  if (head) return { type: head[1]!, message };
  return { type: 'UnhandledException', message };
}

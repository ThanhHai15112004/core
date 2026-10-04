import { createHash } from 'node:crypto';
import type { LogEntry, LogEntryLevel, LogMetadata } from '../contracts/log-entry.types.js';

const LEVEL_OF: Record<number, LogEntryLevel> = {
  10: 'verbose',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

/** Field pino / ngữ cảnh đã nâng thành field chuẩn — phần còn lại là metadata. */
const KNOWN = new Set([
  'level',
  'time',
  'msg',
  'message',
  'pid',
  'hostname',
  'context',
  'runtime',
  'instance',
  'reqId',
  'correlationId',
  'jobId',
  'jobType',
  'messageId',
  'executionId',
  'userId',
  'req',
  'res',
  'responseTime',
  'err',
  'stack',
  'errorType',
  'errorCode',
  'durationMs',
]);

/** Message → mẫu để gom lỗi cùng loại: `User 821 not found` và `User 822 not found` → `User {n} not found`. */
export function messageTemplate(message: string): string {
  return (message.split('\n')[0] ?? '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '{uuid}')
    .replace(/\b(0x)?[0-9a-f]{12,}\b/gi, '{hex}')
    .replace(/\d+/g, '{n}')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

/** Fingerprint nhóm lỗi: loại lỗi + module + message chuẩn hoá (tính khi đọc, không lưu). */
export function logFingerprint(
  errorType: string | undefined,
  context: string | undefined,
  message: string,
): string {
  return createHash('sha1')
    .update([errorType ?? '', context ?? '', messageTemplate(message)].join('\u0000'))
    .digest('hex')
    .slice(0, 12);
}

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined;

/** Một dòng JSON pino trong Redis Stream → LogEntry chuẩn hoá cho trang Logs. `null` nếu không đọc được. */
export function toLogEntry(id: string, raw: string): LogEntry | null {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object') return null;
  const time = typeof o.time === 'number' ? o.time : Number(id.split('-')[0]);
  const err = (o.err && typeof o.err === 'object' ? o.err : null) as Record<string, unknown> | null;
  const req = (o.req && typeof o.req === 'object' ? o.req : null) as Record<string, unknown> | null;
  const res = (o.res && typeof o.res === 'object' ? o.res : null) as Record<string, unknown> | null;
  const level = LEVEL_OF[Number(o.level)] ?? 'info';
  let message = str(o.msg) ?? str(o.message) ?? str(err?.message) ?? '';
  let stack = str(err?.stack) ?? str(o.stack);
  // Message nhiều dòng có stack (vd. stack truyền làm message): dòng đầu là message.
  if (!stack && /\n\s+at\s/.test(message)) {
    const nl = message.indexOf('\n');
    stack = message.slice(nl + 1);
    message = message.slice(0, nl);
  }

  const e: LogEntry = { id, t: new Date(time).toISOString(), level, message };
  const set = <K extends keyof LogEntry>(k: K, v: LogEntry[K] | undefined) => {
    if (v !== undefined) e[k] = v;
  };
  set('context', str(o.context));
  set('runtime', str(o.runtime));
  set('instance', str(o.instance));
  set('requestId', str(o.reqId));
  set('correlationId', str(o.correlationId) ?? str(o.reqId));
  set('jobId', str(o.jobId));
  set('jobType', str(o.jobType));
  set('messageId', str(o.messageId));
  set('executionId', str(o.executionId));
  set('userId', str(o.userId));
  if (req) set('route', `${str(req.method) ?? ''} ${(str(req.url) ?? '').split('?')[0]}`.trim());
  const errType =
    str(o.errorType) ?? (err && str(err.type) !== 'Error' ? str(err.type) : undefined);
  set('errorType', errType);
  set('errorCode', str(o.errorCode) ?? str(err?.code));
  set('stack', stack);
  const duration =
    typeof o.responseTime === 'number'
      ? o.responseTime
      : typeof o.durationMs === 'number'
        ? o.durationMs
        : undefined;
  set('durationMs', duration);

  const metadata: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (!KNOWN.has(k)) metadata[k] = v;
  if (res && typeof res.statusCode === 'number') metadata.status = res.statusCode;
  if (req && typeof req.url === 'string') metadata.path = req.url.split('?')[0];
  if (Object.keys(metadata).length) e.metadata = metadata as LogMetadata;

  if (level === 'error' || level === 'fatal' || (level === 'warn' && (errType || stack)))
    e.fingerprint = logFingerprint(errType, e.context, message);
  return e;
}

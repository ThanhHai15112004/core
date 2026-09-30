import { createHash } from 'node:crypto';
import { LOG_ENTRY_LEVELS, type LogEntry, type LogEntryLevel } from '@packages/logging/index.js';

/** ID field lọc được trực tiếp (và nhận từ URL: `?jobId=…`). */
export const LOG_ID_FIELDS = [
  'correlationId',
  'requestId',
  'jobId',
  'messageId',
  'executionId',
  'userId',
] as const;
export type LogIdField = (typeof LOG_ID_FIELDS)[number];

export interface LogFilter {
  levels: LogEntryLevel[] | null;
  runtimes: string[] | null;
  /** Module (Nest context) — so khớp chính xác, không phân biệt hoa thường. */
  module: string | null;
  ids: Partial<Record<LogIdField, string>>;
  /** Một ID bất kỳ (dán ID vào ô tìm): khớp mọi field ID hoặc có trong message. */
  anyId: string | null;
  /** Từ khoá (AND) và cụm từ trong nháy — tìm trong message, module, loại lỗi. */
  terms: string[];
  /** HTTP status chính xác (`404`) hoặc theo nhóm (`5` = 5xx). */
  status: { exact: number } | { class: number } | null;
  endpoint: string | null;
  errorType: string | null;
  instance: string | null;
  fingerprint: string | null;
  /** epoch ms */
  from: number | null;
  to: number | null;
}

export const EMPTY_LOG_FILTER: LogFilter = {
  levels: null,
  runtimes: null,
  module: null,
  ids: {},
  anyId: null,
  terms: [],
  status: null,
  endpoint: null,
  errorType: null,
  instance: null,
  fingerprint: null,
  from: null,
  to: null,
};

const KEY_ALIASES: Record<string, string> = {
  level: 'level',
  lvl: 'level',
  source: 'runtime',
  runtime: 'runtime',
  service: 'runtime',
  module: 'module',
  context: 'module',
  jobid: 'jobId',
  job: 'jobId',
  requestid: 'requestId',
  req: 'requestId',
  request: 'requestId',
  correlationid: 'correlationId',
  correlation: 'correlationId',
  corr: 'correlationId',
  trace: 'correlationId',
  traceid: 'correlationId',
  messageid: 'messageId',
  msg: 'messageId',
  message: 'messageId',
  executionid: 'executionId',
  execution: 'executionId',
  exec: 'executionId',
  userid: 'userId',
  user: 'userId',
  status: 'status',
  endpoint: 'endpoint',
  path: 'endpoint',
  route: 'endpoint',
  errortype: 'errorType',
  error: 'errorType',
  type: 'errorType',
  instance: 'instance',
  host: 'instance',
  fp: 'fingerprint',
  fingerprint: 'fingerprint',
  id: 'anyId',
};

/** Level theo tên người dùng hay gõ. */
function levelOf(value: string): LogEntryLevel | null {
  const v = value.toLowerCase();
  if (v === 'warning') return 'warn';
  if (v === 'err') return 'error';
  if (v === 'trace') return 'verbose';
  return (LOG_ENTRY_LEVELS as string[]).includes(v) ? (v as LogEntryLevel) : null;
}

/** `404` → exact; `5xx` / `5**` → class. */
export function parseStatus(raw: string): LogFilter['status'] {
  const v = raw.trim().toLowerCase();
  if (/^[1-5]\d\d$/.test(v)) return { exact: Number(v) };
  if (/^[1-5](xx|\*\*)$/.test(v)) return { class: Number(v[0]) };
  return null;
}

/** Một token trông như ID (UUID, `req_…`, `job-123`, số dài) — dán thẳng vào ô tìm. */
export function looksLikeId(token: string): boolean {
  if (token.length < 4 || token.length > 256 || /\s/.test(token)) return false;
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token) ||
    /^[a-z]{2,10}[_:-][\w:.-]+$/i.test(token) ||
    /^\d{3,}$/.test(token) ||
    /^[0-9a-z]{6,}-[0-9a-z]{4,}$/i.test(token)
  );
}

/**
 * Cú pháp tìm kiếm cơ bản: `level:error source:worker jobId:82920 "StorageTimeout" upload`.
 * `key:value` chưa biết coi là từ khoá; một token duy nhất trông như ID → tìm theo mọi field ID.
 */
export function parseLogQuery(raw: string, base: LogFilter = EMPTY_LOG_FILTER): LogFilter {
  const f: LogFilter = { ...base, ids: { ...base.ids }, terms: [...base.terms] };
  const tokens = raw.match(/(\w+:"[^"]*"|"[^"]*"|\S+)/g) ?? [];
  const levels = new Set<LogEntryLevel>(f.levels ?? []);
  const runtimes = new Set<string>(f.runtimes ?? []);
  const loose: string[] = [];
  for (const token of tokens) {
    const kv = /^(\w+):(.+)$/.exec(token);
    const key = kv ? KEY_ALIASES[kv[1]!.toLowerCase()] : undefined;
    if (kv && key) {
      const value = kv[2]!.replace(/^"|"$/g, '');
      if (!value) continue;
      switch (key) {
        case 'level':
          for (const v of value.split(',')) {
            const l = levelOf(v);
            if (l) levels.add(l);
          }
          break;
        case 'runtime':
          for (const v of value.split(',')) runtimes.add(v.toLowerCase());
          break;
        case 'status':
          f.status = parseStatus(value);
          break;
        case 'anyId':
          f.anyId = value;
          break;
        case 'module':
        case 'endpoint':
        case 'errorType':
        case 'instance':
        case 'fingerprint':
          f[key] = value;
          break;
        default:
          f.ids[key as LogIdField] = value;
      }
      continue;
    }
    const phrase = token.replace(/^"|"$/g, '');
    if (phrase) loose.push(phrase);
  }
  if (loose.length === 1 && tokens.length === 1 && looksLikeId(loose[0]!)) f.anyId = loose[0]!;
  else f.terms.push(...loose.map((t) => t.toLowerCase()));
  f.levels = levels.size ? [...levels] : null;
  f.runtimes = runtimes.size ? [...runtimes] : null;
  return f;
}

function statusOf(e: LogEntry): number | null {
  const s = e.metadata?.status;
  return typeof s === 'number' ? s : null;
}

function pathOf(e: LogEntry): string {
  const p = e.metadata?.path;
  return `${typeof p === 'string' ? p : ''} ${e.route ?? ''}`.toLowerCase();
}

export function entryTime(e: LogEntry): number {
  return Date.parse(e.t);
}

export function matchesLog(e: LogEntry, f: LogFilter): boolean {
  const at = entryTime(e);
  if (f.from !== null && at < f.from) return false;
  if (f.to !== null && at > f.to) return false;
  if (f.levels && !f.levels.includes(e.level)) return false;
  if (f.runtimes && !f.runtimes.includes(e.runtime ?? '')) return false;
  if (f.module && (e.context ?? '').toLowerCase() !== f.module.toLowerCase()) return false;
  for (const k of LOG_ID_FIELDS) {
    const want = f.ids[k];
    if (want && e[k] !== want) return false;
  }
  if (f.anyId) {
    const id = f.anyId;
    // ID trong field chuẩn, hoặc nằm trong nội dung log (vd. `Job 82920 failed`).
    if (
      !LOG_ID_FIELDS.some((k) => e[k] === id) &&
      e.id !== id &&
      !`${e.message} ${e.context ?? ''} ${e.errorType ?? ''}`
        .toLowerCase()
        .includes(id.toLowerCase())
    )
      return false;
  }
  if (f.status) {
    const s = statusOf(e);
    if (s === null) return false;
    if ('exact' in f.status ? s !== f.status.exact : Math.floor(s / 100) !== f.status.class)
      return false;
  }
  if (f.endpoint && !pathOf(e).includes(f.endpoint.toLowerCase())) return false;
  if (f.errorType && (e.errorType ?? '').toLowerCase() !== f.errorType.toLowerCase()) return false;
  if (f.instance && !(e.instance ?? '').includes(f.instance)) return false;
  if (f.fingerprint && e.fingerprint !== f.fingerprint) return false;
  if (f.terms.length) {
    const hay = `${e.message} ${e.context ?? ''} ${e.errorType ?? ''}`.toLowerCase();
    if (!f.terms.every((t) => hay.includes(t))) return false;
  }
  return true;
}

/** Thứ tự mới nhất trước: thời gian giảm dần, cùng ms thì theo ID. */
export function compareNewestFirst(a: LogEntry, b: LogEntry): number {
  const d = entryTime(b) - entryTime(a);
  if (d !== 0) return d;
  return (b.id ?? '') < (a.id ?? '') ? -1 : (b.id ?? '') > (a.id ?? '') ? 1 : 0;
}

export interface LogCursor {
  t: number;
  id: string;
}

export function encodeLogCursor(e: LogEntry): string {
  return Buffer.from(JSON.stringify({ t: entryTime(e), id: e.id ?? '' })).toString('base64url');
}

export function decodeLogCursor(raw: string | null): LogCursor | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<LogCursor>;
    return typeof v.t === 'number' && typeof v.id === 'string' ? { t: v.t, id: v.id } : null;
  } catch {
    return null;
  }
}

/** `e` cũ hơn cursor (trang sau khi cuộn xuống). */
export function olderThan(e: LogEntry, c: LogCursor): boolean {
  const t = entryTime(e);
  return t < c.t || (t === c.t && (e.id ?? '') < c.id);
}

/** `e` mới hơn cursor (live tail). */
export function newerThan(e: LogEntry, c: LogCursor): boolean {
  const t = entryTime(e);
  return t > c.t || (t === c.t && (e.id ?? '') > c.id);
}

/**
 * Log cũ (ghi trước khi có structured log) không có `id` và dồn stack vào message: gán ID ổn định và tách stack.
 */
export function normalizeStoredEntry(raw: LogEntry, runtime: string): LogEntry {
  const e: LogEntry = { ...raw, runtime: raw.runtime ?? runtime };
  if (!e.id) {
    const h = createHash('sha1').update(`${runtime}|${e.t}|${e.message}`).digest('hex').slice(0, 8);
    e.id = `${Date.parse(e.t).toString(36)}-l${h}`;
  }
  if (!e.stack && /\n\s+at\s/.test(e.message)) {
    const nl = e.message.indexOf('\n');
    e.stack = e.message.slice(nl + 1);
    e.message = e.message.slice(0, nl);
  }
  return e;
}

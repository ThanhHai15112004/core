import {
  Inject,
  Injectable,
  Optional,
  type LoggerService as NestLoggerService,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { CoreConfigService } from '@packages/config/index.js';
import type { LoggerContract } from '../contracts/logger.contract.js';
import { RequestContextService } from '../context/request-context.service.js';
import {
  LOG_SINK,
  type LogEntry,
  type LogEntryLevel,
  type LogMetadata,
  type LogSink,
} from '../contracts/log-sink.contract.js';
import { LogLevel } from '../constants/logging.constant.js';
import { redactMetadata, redactText } from '../utils/log-redaction.js';
import { errorTypeFromText, fingerprintOf } from '../utils/log-fingerprint.js';

/* Mức càng cao càng quan trọng; log dưới mức hiện tại bị bỏ qua. */
const LEVEL_RANK: Record<LogEntryLevel, number> = {
  verbose: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};
const MIN_RANK: Record<LogLevel, number> = {
  [LogLevel.VERBOSE]: 0,
  [LogLevel.DEBUG]: 1,
  [LogLevel.INFO]: 2,
  [LogLevel.WARN]: 3,
  [LogLevel.ERROR]: 4,
};

const CONSOLE: Record<LogEntryLevel, (line: string) => void> = {
  verbose: (l) => console.info(l),
  debug: (l) => console.debug(l),
  info: (l) => console.log(l),
  warn: (l) => console.warn(l),
  error: (l) => console.error(l),
  fatal: (l) => console.error(l),
};

/** Field ID trong metadata được nâng lên thành field chuẩn của log (để lọc / nối màn khác). */
const ID_FIELDS = [
  'correlationId',
  'requestId',
  'jobId',
  'messageId',
  'executionId',
  'userId',
] as const;
const MAX_MESSAGE = 8000;
const MAX_STACK = 16000;

/**
 * Level tạm thời do System Console đặt: hết hạn thì tự về level gốc. `modules` rỗng = cả runtime; có module thì
 * chỉ các module đó được ghi ở level thấp hơn (scoped debug).
 */
export interface LogLevelOverride {
  level: LogLevel;
  /** epoch ms; `null` = tới khi đổi lại. */
  until: number | null;
  modules: string[];
}

export interface LoggerStats {
  /** Log bị bỏ qua vì dưới level hiện tại (không phải mất dữ liệu). */
  suppressed: number;
  written: number;
  redacted: number;
}

function isStackTrace(value: string): boolean {
  return /\n\s+at\s/.test(value);
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

let seq = 0;
/** ID sắp xếp được theo thời gian: `<epoch ms base36>-<seq>-<rand>`. */
export function newLogId(at: number): string {
  seq = (seq + 1) % 1_679_616;
  return `${at.toString(36)}-${seq.toString(36).padStart(4, '0')}${randomBytes(2).toString('hex')}`;
}

/**
 * Logger chính của mọi runtime (được gắn qua `app.useLogger`).
 * Mỗi log thành một bản ghi có cấu trúc: message + metadata + ngữ cảnh (request / job / message / Scheduler) +
 * lỗi (loại, stack, fingerprint). Dữ liệu nhạy cảm được che **trước** khi ghi console hay chuyển sang `LOG_SINK`.
 *
 * Gọi được theo kiểu Nest: `logger.log('text', 'Context')`, `logger.error('text', stack, 'Context')`, hoặc có cấu trúc:
 * `logger.error({ message: 'Job processing failed', jobId, queue, attempt }, err.stack, 'ReportProcessor')`.
 */
@Injectable()
export class CoreLoggerService implements NestLoggerService, LoggerContract {
  private baseLevel: LogLevel = LogLevel.INFO;
  private override: LogLevelOverride | null = null;
  private readonly format: 'json' | 'text';
  private readonly stats: LoggerStats = { suppressed: 0, written: 0, redacted: 0 };

  constructor(
    @Optional() @Inject(LOG_SINK) private readonly sink?: LogSink,
    @Optional() config?: CoreConfigService,
  ) {
    this.baseLevel = (config?.logs.level as LogLevel | undefined) ?? LogLevel.INFO;
    this.format = config?.logs.format ?? 'text';
  }

  /** Level đang áp dụng (level tạm thời nếu còn hạn và áp cho cả runtime). */
  public getLogLevel(): LogLevel {
    const o = this.activeOverride();
    return o && o.modules.length === 0 ? o.level : this.baseLevel;
  }

  public getBaseLevel(): LogLevel {
    return this.baseLevel;
  }

  public getOverride(): LogLevelOverride | null {
    return this.activeOverride();
  }

  public getStats(): LoggerStats {
    return { ...this.stats };
  }

  /** Đổi level gốc (vĩnh viễn trong process này) và bỏ level tạm thời. */
  public setLogLevel(level: LogLevel | string): void {
    const upper = level.toUpperCase() as LogLevel;
    this.baseLevel = upper in MIN_RANK ? upper : LogLevel.INFO;
    this.override = null;
  }

  public setOverride(override: LogLevelOverride | null): void {
    this.override =
      override && override.level in MIN_RANK
        ? { ...override, modules: override.modules.filter(Boolean) }
        : null;
  }

  public log(message: unknown, ...params: unknown[]): void {
    this.write('info', message, params);
  }

  public error(message: unknown, ...params: unknown[]): void {
    this.write('error', message, params);
  }

  public warn(message: unknown, ...params: unknown[]): void {
    this.write('warn', message, params);
  }

  public debug(message: unknown, ...params: unknown[]): void {
    this.write('debug', message, params);
  }

  public verbose(message: unknown, ...params: unknown[]): void {
    this.write('verbose', message, params);
  }

  public fatal(message: unknown, ...params: unknown[]): void {
    this.write('fatal', message, params);
  }

  private activeOverride(): LogLevelOverride | null {
    const o = this.override;
    if (o && o.until !== null && o.until <= Date.now()) this.override = null;
    return this.override;
  }

  private enabled(level: LogEntryLevel, context: string | undefined): boolean {
    if (level === 'fatal') return true;
    const rank = LEVEL_RANK[level];
    if (rank >= MIN_RANK[this.baseLevel]) return true;
    const o = this.activeOverride();
    if (!o || rank < MIN_RANK[o.level]) return false;
    return o.modules.length === 0 || (context !== undefined && o.modules.includes(context));
  }

  /** Nest truyền context ở tham số cuối; với `error` có thể có thêm stack trace phía trước. */
  private write(level: LogEntryLevel, message: unknown, params: unknown[]): void {
    const rest = [...params];
    const context =
      rest.length > 0 &&
      typeof rest[rest.length - 1] === 'string' &&
      !isStackTrace(rest[rest.length - 1] as string)
        ? (rest.pop() as string)
        : undefined;
    if (!this.enabled(level, context)) {
      this.stats.suppressed++;
      return;
    }
    try {
      this.emit(this.build(level, message, rest, context));
    } catch {
      // Logger không bao giờ được làm hỏng luồng nghiệp vụ.
    }
  }

  private build(
    level: LogEntryLevel,
    message: unknown,
    rest: unknown[],
    context: string | undefined,
  ): LogEntry {
    const now = Date.now();
    let text = '';
    let stack: string | undefined;
    let errorType: string | undefined;
    let errorCode: string | undefined;
    const meta: Record<string, unknown> = {};
    const extra: string[] = [];

    const absorbError = (err: Error) => {
      errorType ??= err.name && err.name !== 'Error' ? err.name : errorTypeFromText(err.message);
      stack ??= err.stack;
      const code = (err as { code?: unknown }).code;
      if (typeof code === 'string' || typeof code === 'number') errorCode ??= String(code);
    };

    if (message instanceof Error) {
      text = message.message;
      absorbError(message);
    } else if (message && typeof message === 'object' && !Array.isArray(message)) {
      const { message: m, msg, err, error, ...others } = message as Record<string, unknown>;
      const main = m ?? msg;
      text =
        typeof main === 'string' ? main : main === undefined ? stringify(others) : stringify(main);
      for (const e of [err, error]) {
        if (e instanceof Error) absorbError(e);
        else if (e !== undefined) meta.error = e;
      }
      if (main !== undefined) Object.assign(meta, others);
    } else {
      text = stringify(message);
    }

    for (const p of rest) {
      if (p === undefined || p === null) continue;
      if (p instanceof Error) absorbError(p);
      else if (typeof p === 'string') {
        if (isStackTrace(p)) stack ??= p;
        else if (p) extra.push(p);
      } else if (typeof p === 'object' && !Array.isArray(p)) Object.assign(meta, p);
      else extra.push(stringify(p));
    }
    if (extra.length) text = `${text} ${extra.join(' ')}`;
    // Message nhiều dòng (vd. `stack` truyền nhầm làm message): dòng đầu là message, phần còn lại là stack.
    if (isStackTrace(text)) {
      stack ??= text;
      text = text.split('\n')[0] ?? '';
    }
    if (typeof meta.errorType === 'string') errorType ??= meta.errorType;
    if (typeof meta.errorCode === 'string') errorCode ??= meta.errorCode;
    if (level === 'error' || level === 'fatal' || stack)
      errorType ??= errorTypeFromText(stack ?? text);

    const redactedText = redactText(
      text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text,
    );
    const redactedStack = stack ? redactText(stack.slice(0, MAX_STACK)) : undefined;
    const { value: metadata, count: metaCount } = redactMetadata(meta);
    this.stats.redacted += redactedText.count + (redactedStack?.count ?? 0) + metaCount;

    const store = RequestContextService.current();
    const entry: LogEntry = {
      id: newLogId(now),
      t: new Date(now).toISOString(),
      level,
      message: redactedText.text,
    };
    if (context) entry.context = context;
    const ids: Record<(typeof ID_FIELDS)[number], string | undefined> = {
      correlationId: store?.correlationId,
      jobId: store?.jobId,
      messageId: typeof store?.messageId === 'string' ? store.messageId : undefined,
      userId: store?.userId,
      requestId: store?.source?.kind === 'http' ? (store.source.id ?? undefined) : undefined,
      executionId: store?.source?.kind === 'scheduler' ? (store.source.id ?? undefined) : undefined,
    };
    for (const f of ID_FIELDS) {
      const fromMeta = metadata[f];
      const v =
        ids[f] ??
        (typeof fromMeta === 'string' || typeof fromMeta === 'number'
          ? String(fromMeta)
          : undefined);
      if (v) entry[f] = v;
      if (fromMeta !== undefined && (typeof fromMeta === 'string' || typeof fromMeta === 'number'))
        delete metadata[f];
    }
    if (store?.source?.kind === 'http' && store.source.name) entry.route = store.source.name;
    if (store?.source?.kind === 'job' && store.source.name) entry.jobType = store.source.name;
    if (typeof metadata.jobType === 'string') entry.jobType ??= metadata.jobType;
    if (errorType) entry.errorType = errorType;
    if (errorCode) entry.errorCode = errorCode;
    if (redactedStack) entry.stack = redactedStack.text;
    if (typeof metadata.durationMs === 'number') entry.durationMs = metadata.durationMs;
    if (Object.keys(metadata).length) entry.metadata = metadata as LogMetadata;
    if (
      LEVEL_RANK[level] >= LEVEL_RANK.warn &&
      (errorType || stack || LEVEL_RANK[level] >= LEVEL_RANK.error)
    ) {
      entry.fingerprint = fingerprintOf({
        errorType,
        context,
        message: entry.message,
        stack: entry.stack,
      }).fingerprint;
    }
    return entry;
  }

  private emit(entry: LogEntry): void {
    this.stats.written++;
    if (this.format === 'json') CONSOLE[entry.level](JSON.stringify(entry));
    else {
      const meta = entry.metadata ? ` ${JSON.stringify(entry.metadata)}` : '';
      CONSOLE[entry.level](
        `${entry.t} ${entry.level.toUpperCase()} ${entry.context ? `[${entry.context}] ` : ''}${entry.message}${meta}${
          entry.stack ? `\n${entry.stack}` : ''
        }`,
      );
    }
    this.sink?.write(entry);
  }
}

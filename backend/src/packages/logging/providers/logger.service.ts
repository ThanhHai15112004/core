import {
  Inject,
  Injectable,
  Optional,
  type LoggerService as NestLoggerService,
} from '@nestjs/common';
import type { LoggerContract } from '../contracts/logger.contract.js';
import { RequestContextService } from '../context/request-context.service.js';
import { LOG_SINK, type LogEntryLevel, type LogSink } from '../contracts/log-sink.contract.js';
import { LogLevel } from '../constants/logging.constant.js';

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

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? value.message;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Logger chính của mọi runtime (được gắn qua `app.useLogger`).
 * Tôn trọng log level, ghi ra console và chuyển tiếp sang `LOG_SINK` nếu có.
 */
@Injectable()
export class CoreLoggerService implements NestLoggerService, LoggerContract {
  private logLevel: LogLevel = LogLevel.INFO;

  constructor(@Optional() @Inject(LOG_SINK) private readonly sink?: LogSink) {}

  public getLogLevel(): LogLevel {
    return this.logLevel;
  }

  public setLogLevel(level: LogLevel | string): void {
    const upper = level.toUpperCase() as LogLevel;
    this.logLevel = upper in MIN_RANK ? upper : LogLevel.INFO;
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

  /** Nest truyền context ở tham số cuối; với `error` có thể có thêm stack trace phía trước. */
  private write(level: LogEntryLevel, message: unknown, params: unknown[]): void {
    if (LEVEL_RANK[level] < MIN_RANK[this.logLevel] && level !== 'fatal') return;

    const rest = [...params];
    const context = typeof rest[rest.length - 1] === 'string' ? (rest.pop() as string) : undefined;
    const trace = rest.map(stringify).filter(Boolean).join('\n');
    const text = stringify(message);
    const t = new Date().toISOString();

    CONSOLE[level](
      `${t} ${level.toUpperCase()} ${context ? `[${context}] ` : ''}${text}${trace ? `\n${trace}` : ''}`,
    );
    const correlationId = RequestContextService.currentCorrelationId();
    this.sink?.write({
      t,
      level,
      ...(context ? { context } : {}),
      ...(correlationId ? { correlationId } : {}),
      message: trace ? `${text}\n${trace}` : text,
    });
  }
}

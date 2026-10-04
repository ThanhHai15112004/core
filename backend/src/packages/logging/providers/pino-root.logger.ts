import { hostname } from 'node:os';
import { multistream, pino, type DestinationStream, type Logger } from 'pino';
import { RequestContextService } from '../context/request-context.service.js';
import { redactText } from '../utils/log-redaction.js';
import { RedisStreamDestination } from './redis-stream.destination.js';

/** Level cấu hình (`LOG_LEVEL`) → level pino. */
export const PINO_LEVEL: Record<string, string> = {
  VERBOSE: 'trace',
  DEBUG: 'debug',
  INFO: 'info',
  WARN: 'warn',
  ERROR: 'error',
};
/** Level pino (số) → nhãn. */
export const PINO_LEVEL_LABEL: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

/** Field nhạy cảm luôn bị che (ở gốc log, sâu 1 và 2 cấp). */
const SENSITIVE_FIELDS = [
  'password',
  'oldPassword',
  'newPassword',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'clientSecret',
  'authorization',
  'cookie',
  'apiKey',
  'privateKey',
  'otp',
  'sessionId',
  'creditCardNumber',
  'cvv',
];
export const REDACT_PATHS = [
  ...SENSITIVE_FIELDS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
  'req.headers["x-api-key"]',
  'req.headers["x-auth-token"]',
  'req.headers["proxy-authorization"]',
  'res.headers["set-cookie"]',
];

export interface RootLoggerOptions {
  runtime: string;
  /** `VERBOSE` | `DEBUG` | `INFO` | `WARN` | `ERROR` */
  level: string;
  format: 'json' | 'text';
}

/** Đích Redis Stream dùng chung của process (gắn Redis khi app khởi động — xem LogLevelService). */
export const redisStream = new RedisStreamDestination();

let root: Logger | null = null;

/** stdout dạng chữ dễ đọc khi dev (`LOG_FORMAT=text`); production dùng `json` cho collector. */
const textStdout: DestinationStream = {
  write(line: string) {
    try {
      const o = JSON.parse(line) as Record<string, unknown> & {
        req?: { method?: string; url?: string };
        res?: { statusCode?: number };
        err?: { stack?: string };
      };
      const ctx = typeof o.context === 'string' ? `[${o.context}] ` : '';
      const http = o.req
        ? ` ${o.req.method ?? ''} ${o.req.url ?? ''} ${o.res?.statusCode ?? ''} ${String(o.responseTime ?? '')}ms`
        : '';
      const stack = o.err?.stack ?? (typeof o.stack === 'string' ? o.stack : '');
      process.stdout.write(
        `${new Date(Number(o.time)).toISOString()} ${PINO_LEVEL_LABEL[Number(o.level)] ?? o.level} ${ctx}${String(
          o.msg ?? '',
        )}${http}${stack ? `\n${stack}` : ''}\n`,
      );
    } catch {
      process.stdout.write(line);
    }
  },
};

/** Field ngữ cảnh (job / execution / user) từ RequestContext gắn vào mọi log. */
function contextFields(): Record<string, unknown> {
  const s = RequestContextService.current();
  if (!s) return {};
  const out: Record<string, unknown> = {};
  if (s.correlationId) out.correlationId = s.correlationId;
  if (s.jobId) out.jobId = s.jobId;
  if (s.userId) out.userId = s.userId;
  if (typeof s.messageId === 'string') out.messageId = s.messageId;
  if (s.source?.kind === 'scheduler' && s.source.id) out.executionId = s.source.id;
  if (s.source?.kind === 'job' && s.source.name) out.jobType = s.source.name;
  return out;
}

/**
 * Pino root logger của process (singleton — nestjs-pino cũng giữ root ở mức module). Ghi JSON ra stdout và Redis
 * Stream; che field nhạy cảm theo tên (`redact`) và theo mẫu trong chuỗi (Bearer, JWT, `password=…`).
 */
export function createRootLogger(opts: RootLoggerOptions): Logger {
  if (root) return root;
  const stdout: DestinationStream = opts.format === 'json' ? process.stdout : textStdout;
  root = pino(
    {
      level: PINO_LEVEL[opts.level] ?? 'info',
      base: { runtime: opts.runtime, instance: `${hostname()}:${process.pid}` },
      redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
      mixin: contextFields,
      formatters: {
        log(obj) {
          if (typeof obj.stack === 'string') obj.stack = redactText(obj.stack).text;
          return obj;
        },
      },
      hooks: {
        logMethod(args, method) {
          for (let i = 0; i < args.length; i++) {
            const v: unknown = args[i];
            if (typeof v === 'string') (args as unknown[])[i] = redactText(v).text;
          }
          method.apply(this, args);
        },
      },
    },
    multistream([
      { level: 'trace', stream: stdout },
      { level: 'trace', stream: redisStream },
    ]),
  );
  return root;
}

export function getRootLogger(): Logger | null {
  return root;
}

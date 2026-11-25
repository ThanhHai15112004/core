import { hostname } from 'node:os';
import { context, isSpanContextValid, trace } from '@opentelemetry/api';
import { multistream, pino, type DestinationStream, type Logger } from 'pino';
import { PINO_LEVEL, PINO_LEVEL_LABEL } from '../constants/logging.constant.js';
import { RequestContextService } from '../context/request-context.service.js';
import { configureExtraSensitiveKeys, redactSensitiveData } from '../redaction/redact.util.js';
import { ExternalLogSinkDestination } from '../sinks/external-log-sink.destination.js';
import { redactText } from '../utils/log-redaction.js';
import { RedisStreamDestination } from './redis-stream.destination.js';

export { PINO_LEVEL, PINO_LEVEL_LABEL };

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
  serviceName?: string;
  extraRedactKeys?: readonly string[];
}

/** Đích Redis Stream dùng chung của process (gắn Redis khi app khởi động — xem LogLevelService). */
export const redisStream = new RedisStreamDestination();
/** Đích gửi log tập trung sang Loki / OpenSearch / SIEM (tắt mặc định nếu chưa bật). */
export const externalLogSink = new ExternalLogSinkDestination();

let root: Logger | null = null;

/** stdout dạng chữ dễ đọc khi dev (`LOG_FORMAT=text`); production dùng `json` cho collector. */
const textStdout: DestinationStream = {
  /** Ghi dữ liệu vào luồng xuất (stream) hoặc tệp tin */
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

/** Field ngữ cảnh (request / trace / span / module / action / job / user) từ RequestContext & active OTel span gắn vào mọi log. */
function contextFields(): Record<string, unknown> {
  const s = RequestContextService.current();
  const sc = trace.getSpan(context.active())?.spanContext();
  const hasValidSpan = Boolean(sc && isSpanContextValid(sc));
  if (!s && !hasValidSpan) return {};

  const out: Record<string, unknown> = {};
  if (s?.correlationId) out.correlationId = s.correlationId;
  if (s?.requestId) out.requestId = s.requestId;

  const traceId = hasValidSpan && sc ? sc.traceId : s?.traceId;
  const spanId = hasValidSpan && sc ? sc.spanId : s?.spanId;
  if (traceId) out.traceId = traceId;
  if (spanId) out.spanId = spanId;

  if (s?.module) out.module = s.module;
  if (s?.action) out.action = s.action;
  if (s?.jobId) out.jobId = s.jobId;
  if (s?.userId) out.userId = s.userId;
  if (typeof s?.messageId === 'string') out.messageId = s.messageId;
  if (s?.source?.kind === 'scheduler' && s.source.id) out.executionId = s.source.id;
  if (s?.source?.kind === 'job' && s.source.name) out.jobType = s.source.name;
  return out;
}

/**
 * Pino root logger của process (singleton — nestjs-pino cũng giữ root ở mức module). Ghi JSON ra stdout, Redis
 * Stream và external sink (nếu bật); che field nhạy cảm đệ quy (`redact` + `redactSensitiveData`) và theo mẫu chuỗi.
 */
export function createRootLogger(opts: RootLoggerOptions): Logger {
  if (root) return root;
  const extraKeys = (opts.extraRedactKeys ?? []).map((k) => k.trim()).filter(Boolean);
  configureExtraSensitiveKeys(extraKeys);
  const redactPaths = [...REDACT_PATHS, ...extraKeys.flatMap((k) => [k, `*.${k}`, `*.*.${k}`])];
  const stdout: DestinationStream = opts.format === 'json' ? process.stdout : textStdout;
  root = pino(
    {
      level: PINO_LEVEL[opts.level] ?? 'info',
      base: {
        ...(opts.serviceName ? { service: opts.serviceName } : {}),
        runtime: opts.runtime,
        instance: `${hostname()}:${process.pid}`,
      },
      redact: { paths: redactPaths, censor: '[REDACTED]' },
      mixin: contextFields,
      formatters: {
        /** Che đệ quy dữ liệu nhạy cảm trong payload log và stack trace trước khi ghi. */
        log(obj) {
          const sanitized = redactSensitiveData(obj, {
            maxDepth: 6,
            redactStrings: (s) => redactText(s).text,
          }) as Record<string, unknown>;
          if (typeof sanitized.stack === 'string') {
            sanitized.stack = redactText(sanitized.stack).text;
          }
          if (sanitized.err && typeof sanitized.err === 'object') {
            const errObj = sanitized.err as { stack?: unknown; message?: unknown };
            if (typeof errObj.stack === 'string') errObj.stack = redactText(errObj.stack).text;
            if (typeof errObj.message === 'string') {
              errObj.message = redactText(errObj.message).text;
            }
          }
          return sanitized;
        },
      },
      hooks: {
        /** Ghi nhận thông điệp log theo phương thức chỉ định */
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
      { level: 'trace', stream: externalLogSink },
    ]),
  );
  return root;
}

/** Lấy thể hiện Logger gốc của hệ thống Pino */
export function getRootLogger(): Logger | null {
  return root;
}

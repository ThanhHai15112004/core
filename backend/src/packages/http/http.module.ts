import { Global, Module, type OnModuleInit, Optional } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { CoreConfigService } from '@packages/config/index.js';
import { GlobalExceptionFilter } from './filters/global-exception.filter.js';
import { IdempotencyInterceptor } from './interceptors/idempotency.interceptor.js';
import { RequestTimeoutInterceptor } from './interceptors/request-timeout.interceptor.js';
import { TransformResponseInterceptor } from './interceptors/transform-response.interceptor.js';

const RELAXED_JSON_PARSER_WATERMARK = Symbol.for('core:fastify_relaxed_json_parser');
const DEFAULT_JSON_BODY_LIMIT_BYTES = 16 * 1024 * 1024; // 16 MB
const DEFAULT_UPLOAD_BODY_LIMIT_BYTES = 32 * 1024 * 1024; // 32 MB
export const MAX_RAW_BODY_CAPTURE_BYTES = 2 * 1024 * 1024; // 2 MB

export interface ConfigureFastifyBodyParserOptions {
  readonly jsonBodyLimitBytes?: number;
  readonly uploadBodyLimitBytes?: number;
}

export interface RawBodyRequest {
  rawBody?: string;
}

interface FastifyLikeInstance {
  removeContentTypeParser?: (contentType: string) => void;
  addContentTypeParser?: (
    contentType: string,
    opts: { parseAs: 'string' | 'buffer'; bodyLimit?: number },
    parser: (
      req: { headers?: Record<string, unknown>; rawBody?: string },
      body: unknown,
      done: (err: Error | null, value?: unknown) => void,
    ) => void,
  ) => void;
  [RELAXED_JSON_PARSER_WATERMARK]?: boolean;
}

/**
 * Cấu hình Fastify chấp nhận header `Content-Type: application/json` ngay cả khi body rỗng (`""`),
 * tự động chuyển thành `{}` thay vì ném lỗi 400 `FST_ERR_CTP_EMPTY_JSON_BODY`
 * (`Body cannot be empty when content-type is set to 'application/json'`).
 */
export function configureFastifyEmptyJsonBodyParser(
  instance: unknown,
  options?: ConfigureFastifyBodyParserOptions,
): void {
  if (!instance || typeof instance !== 'object') {
    return;
  }
  const fastify = instance as FastifyLikeInstance;
  if (
    fastify[RELAXED_JSON_PARSER_WATERMARK] ||
    typeof fastify.removeContentTypeParser !== 'function' ||
    typeof fastify.addContentTypeParser !== 'function'
  ) {
    return;
  }

  const jsonBodyLimit = Math.max(
    1024,
    options?.jsonBodyLimitBytes ?? DEFAULT_JSON_BODY_LIMIT_BYTES,
  );
  const uploadBodyLimit = Math.max(
    jsonBodyLimit,
    options?.uploadBodyLimitBytes ?? DEFAULT_UPLOAD_BODY_LIMIT_BYTES,
  );

  try {
    fastify.removeContentTypeParser('application/json');
    fastify.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: jsonBodyLimit },
      (
        req: { headers?: Record<string, unknown>; rawBody?: string },
        rawBody: unknown,
        done: (err: Error | null, value?: unknown) => void,
      ) => {
        const body = typeof rawBody === 'string' ? rawBody : '';
        if (
          req &&
          typeof req === 'object' &&
          Buffer.byteLength(body, 'utf8') <= MAX_RAW_BODY_CAPTURE_BYTES
        ) {
          req.rawBody = body;
        }
        if (!body || body.trim().length === 0) {
          done(null, {});
          return;
        }
        try {
          done(null, JSON.parse(body));
        } catch (err) {
          const syntaxError = err instanceof Error ? err : new Error('Invalid JSON body');
          (syntaxError as Error & { statusCode?: number }).statusCode = 400;
          done(syntaxError, undefined);
        }
      },
    );

    // Hỗ trợ nhận trực tiếp luồng nhị phân (Blob / Buffer) cho Chunked Upload mà không cần mã hóa Base64 JSON
    try {
      fastify.removeContentTypeParser('application/octet-stream');
    } catch {
      // Ignore if not registered yet
    }
    fastify.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer', bodyLimit: uploadBodyLimit },
      (
        req: { headers?: Record<string, unknown>; url?: string },
        rawBody: unknown,
        done: (err: Error | null, value?: unknown) => void,
      ) => {
        const chunkBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.alloc(0);
        const rawChunkIdx = req?.headers?.['x-chunk-index'];
        let chunkIndexStr = Array.isArray(rawChunkIdx) ? rawChunkIdx[0] : rawChunkIdx;
        if (chunkIndexStr === undefined && typeof req?.url === 'string') {
          const match = /[?&]chunkIndex=(\d+)/.exec(req.url);
          if (match?.[1]) chunkIndexStr = match[1];
        }
        if (chunkIndexStr !== undefined) {
          done(null, {
            chunkIndex: Number(chunkIndexStr),
            chunkBuffer,
          });
          return;
        }
        done(null, chunkBuffer);
      },
    );

    const formBodyLimit = Math.min(jsonBodyLimit, 2 * 1024 * 1024);
    try {
      fastify.removeContentTypeParser('application/x-www-form-urlencoded');
    } catch {
      // Ignore if not registered yet
    }
    fastify.addContentTypeParser(
      'application/x-www-form-urlencoded',
      { parseAs: 'string', bodyLimit: formBodyLimit },
      (
        req: { headers?: Record<string, unknown>; rawBody?: string },
        rawBody: unknown,
        done: (err: Error | null, value?: unknown) => void,
      ) => {
        const body = typeof rawBody === 'string' ? rawBody : '';
        if (
          req &&
          typeof req === 'object' &&
          Buffer.byteLength(body, 'utf8') <= MAX_RAW_BODY_CAPTURE_BYTES
        ) {
          req.rawBody = body;
        }
        if (!body || body.trim().length === 0) {
          done(null, {});
          return;
        }
        try {
          const params = new URLSearchParams(body);
          const parsed: Record<string, string> = {};
          for (const [key, val] of params.entries()) {
            parsed[key] = val;
          }
          done(null, parsed);
        } catch (err) {
          const parseError =
            err instanceof Error ? err : new Error('Invalid form-urlencoded body');
          (parseError as Error & { statusCode?: number }).statusCode = 400;
          done(parseError, undefined);
        }
      },
    );

    fastify[RELAXED_JSON_PARSER_WATERMARK] = true;
  } catch {
    // Ignore if content-type parser is already locked after server ready
  }
}

@Global()
@Module({
  providers: [
    GlobalExceptionFilter,
    TransformResponseInterceptor,
    IdempotencyInterceptor,
    RequestTimeoutInterceptor,
  ],
  exports: [
    GlobalExceptionFilter,
    TransformResponseInterceptor,
    IdempotencyInterceptor,
    RequestTimeoutInterceptor,
  ],
})
export class HttpModule implements OnModuleInit {
  constructor(
    @Optional() private readonly adapterHost?: HttpAdapterHost,
    @Optional() private readonly config?: CoreConfigService,
  ) { }

  public onModuleInit(): void {
    const instance = this.adapterHost?.httpAdapter?.getInstance?.() as unknown;
    const jsonBodyLimitBytes = this.config?.gateway.bodyLimits.apiJsonBodyLimitBytes;
    const uploadBodyLimitBytes = this.config?.gateway.bodyLimits.apiMaxBodySizeBytes;
    configureFastifyEmptyJsonBodyParser(instance, {
      ...(jsonBodyLimitBytes !== undefined ? { jsonBodyLimitBytes } : {}),
      ...(uploadBodyLimitBytes !== undefined ? { uploadBodyLimitBytes } : {}),
    });
  }
}

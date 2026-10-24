import { Global, Module, type OnModuleInit, Optional } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { GlobalExceptionFilter } from './filters/global-exception.filter.js';
import { TransformResponseInterceptor } from './interceptors/transform-response.interceptor.js';

const RELAXED_JSON_PARSER_WATERMARK = Symbol.for('core:fastify_relaxed_json_parser');
const DEFAULT_JSON_BODY_LIMIT_BYTES = 32 * 1024 * 1024; // 32 MB

interface FastifyLikeInstance {
  removeContentTypeParser?: (contentType: string) => void;
  addContentTypeParser?: (
    contentType: string,
    opts: { parseAs: 'string' | 'buffer'; bodyLimit?: number },
    parser: (
      req: { headers?: Record<string, unknown> },
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
export function configureFastifyEmptyJsonBodyParser(instance: unknown): void {
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

  try {
    fastify.removeContentTypeParser('application/json');
    fastify.addContentTypeParser(
      'application/json',
      { parseAs: 'string', bodyLimit: DEFAULT_JSON_BODY_LIMIT_BYTES },
      (_req: unknown, rawBody: unknown, done: (err: Error | null, value?: unknown) => void) => {
        const body = typeof rawBody === 'string' ? rawBody : '';
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
      { parseAs: 'buffer', bodyLimit: DEFAULT_JSON_BODY_LIMIT_BYTES },
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

    fastify[RELAXED_JSON_PARSER_WATERMARK] = true;
  } catch {
    // Ignore if content-type parser is already locked after server ready
  }
}

@Global()
@Module({
  providers: [GlobalExceptionFilter, TransformResponseInterceptor],
  exports: [GlobalExceptionFilter, TransformResponseInterceptor],
})
export class HttpModule implements OnModuleInit {
  constructor(@Optional() private readonly adapterHost?: HttpAdapterHost) {}

  public onModuleInit(): void {
    const instance = this.adapterHost?.httpAdapter?.getInstance?.() as unknown;
    configureFastifyEmptyJsonBodyParser(instance);
  }
}

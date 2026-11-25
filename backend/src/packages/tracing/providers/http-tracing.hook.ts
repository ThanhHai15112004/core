import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { finishHttpTraceSpan, getHttpTraceState } from '../utils/http-trace-meta.js';
import { recordSpanError } from '../utils/span.util.js';

/**
 * Fastify hook hoàn tất OpenTelemetry `SERVER` span theo route chuẩn (`http.route`),
 * HTTP status code và ghi nhận exception khi request lỗi.
 */
@Injectable()
export class HttpTracingHook implements OnModuleInit {
  private readonly logger = new Logger(HttpTracingHook.name);

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  /** Đăng ký `onError` và `onResponse` lên Fastify instance nếu runtime là HTTP API. */
  public onModuleInit(): void {
    const instance = this.adapterHost.httpAdapter?.getInstance<FastifyInstance>();
    if (!instance?.addHook) {
      this.logger.debug('HTTP adapter is not Fastify — HTTP tracing hook skipped');
      return;
    }

    instance.addHook('onError', (req: FastifyRequest, _reply: FastifyReply, error, done) => {
      const state = getHttpTraceState(req.raw);
      if (state && !state.ended) {
        recordSpanError(state.span, error);
      }
      done();
    });

    instance.addHook('onResponse', (req: FastifyRequest, reply: FastifyReply, done) => {
      const route = req.routeOptions?.url;
      finishHttpTraceSpan(req.raw, reply.statusCode, route, req.method);
      done();
    });
  }
}

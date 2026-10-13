import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { MetricsRegistryService } from './metrics-registry.service.js';

/** Nhãn `route` khi request không khớp route nào (404 của Fastify). */
export const UNMATCHED_ROUTE = 'unmatched';

/**
 * Ghi `http_request_duration_seconds{method,route,status}` bằng hook Fastify `onResponse` — chạy cho MỌI response,
 * kể cả 404 (không có route), lỗi parse body và request bị guard chặn, những trường hợp interceptor của Nest không
 * thấy. `route` là template của Fastify (`/api/v1/users/:id`) để nhãn không bùng nổ.
 */
@Injectable()
export class HttpMetricsHook implements OnModuleInit {
  private readonly logger = new Logger(HttpMetricsHook.name);

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly metrics: MetricsRegistryService,
  ) {}

  /** Đăng ký và khởi tạo các thiết lập tài nguyên khi nạp module */
  public onModuleInit(): void {
    const instance = this.adapterHost.httpAdapter?.getInstance<FastifyInstance>();
    if (!instance?.addHook) {
      this.logger.warn('HTTP adapter is not Fastify — HTTP metrics are not recorded');
      return;
    }
    instance.addHook('onResponse', (req: FastifyRequest, reply: FastifyReply, done) => {
      this.record(req, reply);
      done();
    });
  }

  /** Ghi nhận một sự kiện vận hành mới vào bộ nhớ */
  private record(req: FastifyRequest, reply: FastifyReply): void {
    const route = req.routeOptions?.url ?? UNMATCHED_ROUTE;
    if (route.endsWith('/metrics')) return;
    this.metrics.httpDuration.observe(
      { method: req.method, route, status: String(reply.statusCode) },
      reply.elapsedTime / 1000,
    );
  }
}

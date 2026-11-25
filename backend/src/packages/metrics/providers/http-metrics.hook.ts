import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Counter } from 'prom-client';
import { MetricsRegistryService } from './metrics-registry.service.js';

/** Nhãn `route` khi request không khớp route nào (404 của Fastify). */
export const UNMATCHED_ROUTE = 'unmatched';

/**
 * Ghi `http_request_duration_seconds{method,route,status}` và `http_request_timeouts_total{method,route,status}`
 * bằng hook Fastify `onResponse` — chạy cho MỌI response, kể cả 404, lỗi parse body, guard chặn và 408/504 timeout.
 */
@Injectable()
export class HttpMetricsHook implements OnModuleInit {
  private readonly logger = new Logger(HttpMetricsHook.name);
  private readonly timeoutsCounter: Counter<'method' | 'route' | 'status'>;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly metrics: MetricsRegistryService,
  ) {
    this.timeoutsCounter = metrics.counter(
      'http_request_timeouts_total',
      'Total HTTP API requests that ended with timeout status (408/504)',
      ['method', 'route', 'status'],
    );
  }

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
    const status = String(reply.statusCode);
    this.metrics.httpDuration.observe(
      { method: req.method, route, status },
      reply.elapsedTime / 1000,
    );
    if (reply.statusCode === 408 || reply.statusCode === 504) {
      this.timeoutsCounter.inc({ method: req.method, route, status });
    }
  }
}

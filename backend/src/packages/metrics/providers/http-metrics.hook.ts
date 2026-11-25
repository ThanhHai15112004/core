import { Injectable, Logger, Optional, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Counter } from 'prom-client';
import { CoreConfigService } from '@packages/config/index.js';
import { resolveHttpMetricModule, statusClassOf } from '../utils/http-module.util.js';
import { MetricsRegistryService } from './metrics-registry.service.js';

/** Nhãn `route` khi request không khớp route nào (404 của Fastify). */
export const UNMATCHED_ROUTE = 'unmatched';

/**
 * Ghi `http_request_duration_seconds{method,route,status,module}`, `http_requests_total` và
 * `http_request_timeouts_total{method,route,status}` bằng hook Fastify `onResponse`.
 */
@Injectable()
export class HttpMetricsHook implements OnModuleInit {
  private readonly logger = new Logger(HttpMetricsHook.name);
  private readonly timeoutsCounter: Counter<'method' | 'route' | 'status'>;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly metrics: MetricsRegistryService,
    @Optional() private readonly config?: CoreConfigService,
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
    const statusClass = statusClassOf(reply.statusCode);
    const module = resolveHttpMetricModule(route, this.config?.app.apiPrefix);
    this.metrics.httpDuration.observe(
      { method: req.method, route, status, module },
      reply.elapsedTime / 1000,
    );
    this.metrics.httpRequestsTotal.inc({
      method: req.method,
      route,
      status,
      status_class: statusClass,
      module,
    });
    if (reply.statusCode === 408 || reply.statusCode === 504) {
      this.timeoutsCounter.inc({ method: req.method, route, status });
    }
  }
}

import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { MetricsRegistryService } from '../providers/metrics-registry.service.js';

/**
 * Ghi `http_request_duration_seconds{method,route,status}`. Đo tới khi response gửi xong (`finish`) nên status là
 * status thật sau exception filter. `route` là template của Fastify (`/api/v1/users/:id`) để nhãn không bùng nổ.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsRegistryService) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const route = req.routeOptions?.url ?? 'unmatched';
    if (route.endsWith('/metrics')) return next.handle();

    const end = this.metrics.httpDuration.startTimer({ method: req.method, route });
    reply.raw.once('finish', () => end({ status: String(reply.raw.statusCode) }));
    return next.handle();
  }
}

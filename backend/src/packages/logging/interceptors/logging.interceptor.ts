import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { finalize, tap } from 'rxjs/operators';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequestContextService } from '../context/request-context.service.js';
import { HttpMetricsService } from '../metrics/http-metrics.service.js';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(
    private readonly contextService: RequestContextService,
    private readonly metrics: HttpMetricsService,
  ) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();
    const startTime = Date.now();

    const method = req.method;
    const url = req.url;
    const correlationId = this.contextService.getCorrelationId();

    this.metrics.begin();
    return next.handle().pipe(
      finalize(() => this.metrics.end()),
      tap({
        next: () => {
          const duration = Date.now() - startTime;
          const statusCode = reply.statusCode || 200;
          this.metrics.record(duration, statusCode);
          this.logger.log(`[${correlationId}] ${method} ${url} ${statusCode} +${duration}ms`);
        },
        error: (err: unknown) => {
          const duration = Date.now() - startTime;
          const status = resolveErrorStatus(err);
          this.metrics.record(duration, status);
          this.logger.error(`[${correlationId}] ${method} ${url} ${status} +${duration}ms`);
        },
      }),
    );
  }
}

/** HttpException dùng `status`, AppException dùng `statusCode`; còn lại coi là 500. */
function resolveErrorStatus(err: unknown): number {
  if (err && typeof err === 'object') {
    const { status, statusCode } = err as { status?: unknown; statusCode?: unknown };
    if (typeof status === 'number') return status;
    if (typeof statusCode === 'number') return statusCode;
  }
  return 500;
}

import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequestContextService } from '../context/request-context.service.js';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly contextService: RequestContextService) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const req = ctx.getRequest<FastifyRequest>();
    const reply = ctx.getResponse<FastifyReply>();
    const startTime = performance.now();

    const method = req.method;
    const url = req.url;
    const correlationId = this.contextService.getCorrelationId();

    // Metric HTTP được đo ở tầng Fastify (packages/traffic) để không bỏ sót 401/404; ở đây chỉ log.
    return next.handle().pipe(
      tap({
        next: () => {
          // Đồng hồ monotonic: Date.now() có thể nhảy (đồng bộ giờ) và cho thời lượng âm.
          const duration = Math.round(performance.now() - startTime);
          const statusCode = reply.statusCode || 200;
          this.logger.log(line(method, url, statusCode, duration, correlationId));
        },
        error: (err: unknown) => {
          const duration = Math.round(performance.now() - startTime);
          const status = resolveErrorStatus(err);
          const entry = line(method, url, status, duration, correlationId);
          // 4xx là lỗi phía client (validation, 404…) — cảnh báo; 5xx mới là lỗi hệ thống (stack do exception filter ghi).
          if (status >= 500) this.logger.error({ ...entry, errorType: errorName(err) });
          else this.logger.warn(entry);
        },
      }),
    );
  }
}

/** Log HTTP có cấu trúc: trang Logs lọc được theo status / endpoint / thời gian xử lý. */
function line(
  method: string,
  url: string,
  status: number,
  durationMs: number,
  correlationId: string,
) {
  const path = url.split('?')[0] ?? url;
  return {
    message: `${method} ${path} ${status} ${durationMs}ms`,
    method,
    path,
    status,
    durationMs,
    correlationId,
  };
}

function errorName(err: unknown): string | undefined {
  return err instanceof Error && err.name !== 'Error' ? err.name : undefined;
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

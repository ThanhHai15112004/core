import {
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  Injectable,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { FastifyReply } from 'fastify';
import type { ApiSuccessResponse } from '../contracts/api-response.contract.js';

@Injectable()
export class TransformResponseInterceptor<T> implements NestInterceptor<T, ApiSuccessResponse<T>> {
  public intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T>> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const statusCode = response.statusCode || 200;

    return next.handle().pipe(
      map((data: T) => {
        // If the data already contains meta or is an envelope, handle appropriately
        if (typeof data === 'object' && data !== null && 'data' in data && 'meta' in data) {
          const complexData = data as { data: unknown; meta?: Record<string, unknown> };
          return {
            success: true as const,
            statusCode,
            data: complexData.data as T,
            ...(complexData.meta ? { meta: complexData.meta } : {}),
            timestamp: new Date().toISOString(),
          };
        }

        return {
          success: true as const,
          statusCode,
          data,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}

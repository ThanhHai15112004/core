import {
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  Injectable,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { FastifyReply } from 'fastify';
import { HTTP_STATUS_CODE } from '@packages/kernel/index.js';
import type { ApiSuccessResponse } from '../contracts/api-response.contract.js';

/** Kiểm tra dữ liệu trả về đã được đóng gói theo cấu trúc ApiSuccessResponse hay chưa */
function isAlreadyWrappedEnvelope<T>(value: unknown): value is ApiSuccessResponse<T> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record['success'] === true &&
    typeof record['statusCode'] === 'number' &&
    'data' in record &&
    typeof record['timestamp'] === 'string'
  );
}

@Injectable()
export class TransformResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiSuccessResponse<T> | undefined
> {
  /** Chặn và can thiệp vào luồng xử lý yêu cầu hoặc phản hồi HTTP */
  public intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T> | undefined> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();

    return next.handle().pipe(
      map((data: T) => {
        const statusCode = response.statusCode || HTTP_STATUS_CODE.OK;

        if (statusCode === HTTP_STATUS_CODE.NO_CONTENT) {
          return undefined;
        }

        if (isAlreadyWrappedEnvelope<T>(data)) {
          return data;
        }

        // If the data already contains meta or is a paginated envelope, handle appropriately
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

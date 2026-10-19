import {
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  Injectable,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { FastifyReply } from 'fastify';
import { getMetadataArgsStorage } from 'typeorm';
import {
  HTTP_ERROR_CODE,
  HTTP_STATUS_CODE,
  InternalServerAppException,
} from '@packages/kernel/index.js';
import type { ApiSuccessResponse } from '../contracts/api-response.contract.js';

const ORM_ENTITY_WATERMARK = Symbol.for('core:orm_entity');

/** Kiểm tra một đối tượng đơn lẻ có phải là thực thể ORM (TypeORM @Entity hoặc TypeOrmBaseEntity) hay không */
function isSingleOrmEntity(item: unknown): boolean {
  if (typeof item !== 'object' || item === null || Array.isArray(item) || item instanceof Date) {
    return false;
  }
  if (ORM_ENTITY_WATERMARK in item) {
    return true;
  }
  const ctor = (item as { constructor?: unknown }).constructor;
  if (typeof ctor !== 'function' || ctor === Object) {
    return false;
  }
  if ((ctor as unknown as Record<symbol, unknown>)[ORM_ENTITY_WATERMARK] === true) {
    return true;
  }
  return getMetadataArgsStorage().tables.some((table) => table.target === ctor);
}

/** Kiểm tra payload trả về (đơn lẻ, mảng hoặc phân trang) có làm rò rỉ trực tiếp ORM Entity ra API hay không */
function containsOrmEntity(payload: unknown): boolean {
  if (payload === null || payload === undefined) {
    return false;
  }
  if (Array.isArray(payload)) {
    return payload.length > 0 && isSingleOrmEntity(payload[0]);
  }
  return isSingleOrmEntity(payload);
}

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

const SENSITIVE_RESPONSE_FIELDS = new Set([
  'passwordhash',
  'totpsecret',
  'clientsecrethash',
  'recoverycodeshashjson',
  'emailotpcodehash',
  'smsotpcodehash',
  'codehash',
  'refreshtokenhash',
  'encryptedsecret',
]);

/**
 * Che giấu đệ quy các trường bí mật/băm nội bộ nếu vô tình xuất hiện trong payload phản hồi HTTP (Mục 4.5).
 */
export function redactSensitiveResponseData<T>(data: T, depth = 0): T {
  if (depth > 8 || data === null || data === undefined) {
    return data;
  }
  if (Array.isArray(data)) {
    let mutated = false;
    const nextArr = data.map((item) => {
      const redactedItem = redactSensitiveResponseData(item, depth + 1);
      if (redactedItem !== item) mutated = true;
      return redactedItem;
    });
    return (mutated ? nextArr : data) as unknown as T;
  }
  if (typeof data === 'object' && !(data instanceof Date) && !Buffer.isBuffer(data)) {
    let mutated = false;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_RESPONSE_FIELDS.has(key.toLowerCase())) {
        result[key] = '[REDACTED]';
        mutated = true;
      } else {
        const redactedVal = redactSensitiveResponseData(val, depth + 1);
        if (redactedVal !== val) mutated = true;
        result[key] = redactedVal;
      }
    }
    return (mutated ? result : data) as unknown as T;
  }
  return data;
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
          if (containsOrmEntity(data.data)) {
            throw new InternalServerAppException(
              HTTP_ERROR_CODE.ORM_ENTITY_LEAK_DETECTED,
              [],
              undefined,
              HTTP_ERROR_CODE.ORM_ENTITY_LEAK_DETECTED,
            );
          }
          const redactedInner = redactSensitiveResponseData(data.data);
          return redactedInner === data.data
            ? data
            : {
                ...data,
                data: redactedInner,
              };
        }

        // If the data already contains meta or is a paginated envelope, handle appropriately
        if (typeof data === 'object' && data !== null && 'data' in data && 'meta' in data) {
          const complexData = data as { data: unknown; meta?: Record<string, unknown> };
          if (containsOrmEntity(complexData.data)) {
            throw new InternalServerAppException(
              HTTP_ERROR_CODE.ORM_ENTITY_LEAK_DETECTED,
              [],
              undefined,
              HTTP_ERROR_CODE.ORM_ENTITY_LEAK_DETECTED,
            );
          }
          return {
            success: true as const,
            statusCode,
            data: redactSensitiveResponseData(complexData.data) as T,
            ...(complexData.meta ? { meta: complexData.meta } : {}),
            timestamp: new Date().toISOString(),
          };
        }

        if (containsOrmEntity(data)) {
          throw new InternalServerAppException(
            HTTP_ERROR_CODE.ORM_ENTITY_LEAK_DETECTED,
            [],
            undefined,
            HTTP_ERROR_CODE.ORM_ENTITY_LEAK_DETECTED,
          );
        }

        return {
          success: true as const,
          statusCode,
          data: redactSensitiveResponseData(data),
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}

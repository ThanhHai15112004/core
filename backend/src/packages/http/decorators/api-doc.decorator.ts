import { SetMetadata } from '@nestjs/common';
import type { z } from 'zod';
import type { ValidationSource } from '@packages/kernel/index.js';
import type {
  ApiDocOptions,
  ApiGroupMetadata,
  RecordedValidationSchema,
} from '../contracts/api-docs.contract.js';

export const API_GROUP_METADATA_KEY = 'http:api_group';
export const API_DOC_METADATA_KEY = 'http:api_doc';
export const API_DOC_VALIDATION_METADATA_KEY = 'http:api_doc_validation_schemas';

/**
 * Decorator gom nhóm các API của một Controller trên giao diện Scalar UI và OpenAPI Tags.
 * Tương đương với `@group` trong Scribe.
 */
export function ApiGroup(name: string, description?: string): ClassDecorator {
  const metadata: ApiGroupMetadata = {
    name,
    ...(description ? { description } : {}),
  };
  return SetMetadata(API_GROUP_METADATA_KEY, metadata);
}

/**
 * Decorator mô tả chi tiết tài liệu cho một API Endpoint (tiêu đề, mô tả, schema đầu vào/đầu ra, ví dụ mẫu, mã lỗi).
 */
export function ApiDoc(options: ApiDocOptions): MethodDecorator {
  return SetMetadata(API_DOC_METADATA_KEY, options);
}

/**
 * Ghi nhận tự động Zod Schema từ `@ValidatedBody`, `@ValidatedQuery`, `@ValidatedParams` vào metadata của method.
 */
export function recordValidationSchemaMetadata(
  target: object,
  propertyKey: string | symbol | undefined,
  entry: RecordedValidationSchema,
): void {
  if (!propertyKey) {
    return;
  }
  const descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
  const methodTarget = (descriptor?.value as object | undefined) ?? target;

  const existing =
    (Reflect.getMetadata(API_DOC_VALIDATION_METADATA_KEY, methodTarget) as
      RecordedValidationSchema[] | undefined) ?? [];

  Reflect.defineMetadata(API_DOC_VALIDATION_METADATA_KEY, [...existing, entry], methodTarget);
}

/**
 * Hàm trợ giúp tạo Decorator tham số vừa thực thi Pipe vừa tự động đăng ký Zod Schema cho tài liệu OpenAPI.
 */
export function attachValidationDocMetadata(
  paramDecorator: ParameterDecorator,
  source: ValidationSource,
  schema: z.ZodTypeAny,
  paramKey?: string,
): ParameterDecorator {
  return (target: object, propertyKey: string | symbol | undefined, parameterIndex: number) => {
    recordValidationSchemaMetadata(target, propertyKey, {
      source,
      schema,
      ...(paramKey ? { paramKey } : {}),
    });
    paramDecorator(target, propertyKey, parameterIndex);
  };
}

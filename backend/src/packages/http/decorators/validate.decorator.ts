import { Body, Param, Query } from '@nestjs/common';
import type { z } from 'zod';
import { VALIDATION_SOURCE } from '@packages/kernel/index.js';
import { type ValidationOptions, ZodValidationPipe } from '../utils/validation.util.js';
import { attachValidationDocMetadata } from './api-doc.decorator.js';

/**
 * Decorator kiểm tra và chuẩn hóa dữ liệu `@Body()` theo Zod Schema.
 * Mặc định tự động loại bỏ các trường không nằm trong Whitelist (`unknownFields: 'strip'`)
 * và tự động đăng ký schema vào tài liệu OpenAPI 3.1.
 */
export function ValidatedBody<T>(
  schema: z.ZodType<T>,
  options: Omit<ValidationOptions, 'source'> = {},
): ParameterDecorator {
  const pipeDecorator = Body(
    new ZodValidationPipe(schema, {
      ...options,
      source: VALIDATION_SOURCE.BODY,
    }),
  );
  return attachValidationDocMetadata(pipeDecorator, VALIDATION_SOURCE.BODY, schema);
}

/**
 * Decorator kiểm tra và chuẩn hóa dữ liệu `@Query()` theo Zod Schema.
 * Mặc định tự động loại bỏ các tham số truy vấn không nằm trong Whitelist (`unknownFields: 'strip'`)
 * và tự động đăng ký schema vào tài liệu OpenAPI 3.1.
 */
export function ValidatedQuery<T>(
  schema: z.ZodType<T>,
  options: Omit<ValidationOptions, 'source'> = {},
): ParameterDecorator {
  const pipeDecorator = Query(
    new ZodValidationPipe(schema, {
      ...options,
      source: VALIDATION_SOURCE.QUERY,
    }),
  );
  return attachValidationDocMetadata(pipeDecorator, VALIDATION_SOURCE.QUERY, schema);
}

/**
 * Decorator kiểm tra và chuẩn hóa dữ liệu `@Param()` (toàn bộ object params hoặc 1 tham số cụ thể) theo Zod Schema,
 * đồng thời tự động đăng ký schema vào tài liệu OpenAPI 3.1.
 */
export function ValidatedParams<T>(
  schema: z.ZodType<T>,
  paramKey?: string,
  options: Omit<ValidationOptions, 'source'> = {},
): ParameterDecorator {
  const pipe = new ZodValidationPipe(schema, {
    ...options,
    source: VALIDATION_SOURCE.PARAMS,
  });
  const pipeDecorator = paramKey ? Param(paramKey, pipe) : Param(pipe);
  return attachValidationDocMetadata(pipeDecorator, VALIDATION_SOURCE.PARAMS, schema, paramKey);
}

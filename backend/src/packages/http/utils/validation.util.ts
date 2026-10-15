import { type ArgumentMetadata, Injectable, type PipeTransform } from '@nestjs/common';
import { z } from 'zod';
import {
  HTTP_ERROR_CODE,
  VALIDATION_ISSUE_CODE,
  VALIDATION_SOURCE,
  ValidationAppException,
  type ValidationSource,
} from '@packages/kernel/index.js';
import type { ApiErrorDetail } from '../contracts/api-response.contract.js';
import { formatZodIssues, isPrintableString } from './query-list.util.js';

/**
 * Chính sách xử lý các trường dữ liệu không nằm trong danh sách cho phép (Whitelist):
 * - `strip` (Mặc định): Tự động loại bỏ mọi field lạ trước khi đưa vào Controller/Service (chống Mass Assignment).
 * - `reject`: Chặn request và trả về lỗi 400 `UNRECOGNIZED_FIELDS` kèm danh sách các field vi phạm.
 */
export const UNKNOWN_FIELD_POLICIES = {
  STRIP: 'strip',
  REJECT: 'reject',
} as const;

export type UnknownFieldPolicy =
  (typeof UNKNOWN_FIELD_POLICIES)[keyof typeof UNKNOWN_FIELD_POLICIES];

export interface ValidationOptions {
  /** Nguồn dữ liệu cần kiểm tra (`body` | `query` | `params`). */
  readonly source?: ValidationSource;
  /** Chính sách xử lý các trường không được phép gửi lên (mặc định: `'strip'`). */
  readonly unknownFields?: UnknownFieldPolicy;
  /** Mã lỗi tùy chỉnh khi dữ liệu không hợp lệ. */
  readonly errorCode?: string;
}

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const POSITIVE_INT_STRING_REGEX = /^[1-9]\d*$/;
const MAX_PARAM_ID_LENGTH = 256;
const MAX_SLUG_LENGTH = 256;

/**
 * Kiểm tra một giá trị có phải là Plain Object (`Record<string, unknown>`) hay không.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Loại bỏ trực tiếp mọi trường không nằm trong danh sách `allowedFields` khỏi một đối tượng.
 */
export function stripDisallowedFields<T extends Record<string, unknown>>(
  input: Record<string, unknown>,
  allowedFields: readonly string[],
): Partial<T> {
  const allowedSet = new Set<string>(allowedFields);
  const sanitized: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(input)) {
    if (allowedSet.has(key)) {
      sanitized[key] = val;
    }
  }

  return sanitized as Partial<T>;
}

/**
 * Tìm danh sách các trường không nằm trong `allowedFields` của một đối tượng.
 */
export function findDisallowedFields(
  input: Record<string, unknown>,
  allowedFields: readonly string[],
  parentPath = '',
): string[] {
  const allowedSet = new Set<string>(allowedFields);
  const disallowed: string[] = [];

  for (const key of Object.keys(input)) {
    if (!allowedSet.has(key)) {
      disallowed.push(parentPath.length > 0 ? `${parentPath}.${key}` : key);
    }
  }

  return disallowed;
}

/**
 * Áp dụng đệ quy chính sách xử lý trường lạ (`strip` hoặc `reject`) lên `ZodObject` và các schema con.
 */
export function applyUnknownFieldPolicy<T extends z.ZodTypeAny>(
  schema: T,
  policy: UnknownFieldPolicy = UNKNOWN_FIELD_POLICIES.STRIP,
): T {
  if (schema instanceof z.ZodObject) {
    const rawShape = schema.shape as Record<string, z.ZodTypeAny>;
    const nextShape: Record<string, z.ZodTypeAny> = {};

    for (const [key, childSchema] of Object.entries(rawShape)) {
      nextShape[key] = applyUnknownFieldPolicy(childSchema, policy);
    }

    const rebuilt = z.object(nextShape);
    return (policy === UNKNOWN_FIELD_POLICIES.REJECT
      ? rebuilt.strict()
      : rebuilt.strip()) as unknown as T;
  }

  if (schema instanceof z.ZodOptional) {
    return applyUnknownFieldPolicy(
      schema.unwrap() as z.ZodTypeAny,
      policy,
    ).optional() as unknown as T;
  }

  if (schema instanceof z.ZodNullable) {
    return applyUnknownFieldPolicy(
      schema.unwrap() as z.ZodTypeAny,
      policy,
    ).nullable() as unknown as T;
  }

  if (schema instanceof z.ZodDefault) {
    const inner = applyUnknownFieldPolicy(
      schema.removeDefault() as z.ZodTypeAny,
      policy,
    ) as z.ZodTypeAny;
    const defVal = (schema as unknown as { _def: { defaultValue: unknown } })._def.defaultValue;
    const resolvedDefault = typeof defVal === 'function' ? (defVal as () => unknown)() : defVal;
    return inner.default(resolvedDefault as never) as unknown as T;
  }

  if (schema instanceof z.ZodArray) {
    return z.array(applyUnknownFieldPolicy(schema.element as z.ZodTypeAny, policy)) as unknown as T;
  }

  return schema;
}

/**
 * Tạo Zod Object Schema tự động loại bỏ (`strip`) mọi trường không được phép gửi lên (kể cả object lồng nhau).
 */
export function whitelistedObjectSchema<TShape extends z.ZodRawShape>(shape: TShape) {
  return applyUnknownFieldPolicy(z.object(shape), UNKNOWN_FIELD_POLICIES.STRIP);
}

/**
 * Tạo Zod Object Schema nghiêm ngặt (`strict`), lập tức từ chối và báo lỗi nếu xuất hiện bất kỳ trường lạ nào.
 */
export function strictObjectSchema<TShape extends z.ZodRawShape>(shape: TShape) {
  return applyUnknownFieldPolicy(z.object(shape), UNKNOWN_FIELD_POLICIES.REJECT);
}

/**
 * Xác định mã lỗi chuẩn dựa trên nguồn dữ liệu và danh sách lỗi chi tiết.
 */
function resolveValidationErrorCode(
  details: readonly ApiErrorDetail[],
  options?: ValidationOptions,
): string {
  if (options?.errorCode) {
    return options.errorCode;
  }

  if (
    details.length > 0 &&
    details.every((d) => d.code === VALIDATION_ISSUE_CODE.UNRECOGNIZED_KEYS)
  ) {
    return HTTP_ERROR_CODE.UNRECOGNIZED_FIELDS;
  }

  return HTTP_ERROR_CODE.VALIDATION_FAILED;
}

/**
 * Thực thi xác thực dữ liệu đầu vào chung cho `body`, `query`, hoặc `params`.
 */
export function validateInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
  options: ValidationOptions = {},
): T {
  const policy = options.unknownFields ?? UNKNOWN_FIELD_POLICIES.STRIP;
  const source = options.source;
  const effectiveSchema = applyUnknownFieldPolicy(schema, policy);

  const normalizedInput =
    effectiveSchema instanceof z.ZodObject && (input === undefined || input === null) ? {} : input;

  const result = effectiveSchema.safeParse(normalizedInput);
  if (!result.success) {
    const details = formatZodIssues(result.error.issues, source);
    const code = resolveValidationErrorCode(details, options);
    throw new ValidationAppException(details, code, undefined, code);
  }

  return result.data;
}

/**
 * Kiểm tra dữ liệu Request Body (`@Body()`).
 * Mặc định tự động loại bỏ các trường không nằm trong schema (`unknownFields: 'strip'`).
 * Có thể truyền `{ unknownFields: 'reject' }` để chặn và trả về lỗi `UNRECOGNIZED_FIELDS`.
 */
export function validateBody<T>(
  schema: z.ZodType<T>,
  body: unknown,
  options: Omit<ValidationOptions, 'source'> = {},
): T {
  if (
    schema instanceof z.ZodObject &&
    body !== undefined &&
    body !== null &&
    !isPlainObject(body)
  ) {
    const details: ApiErrorDetail[] = [
      {
        message: 'Request body must be a valid JSON object',
        code: VALIDATION_ISSUE_CODE.INVALID_TYPE,
        source: VALIDATION_SOURCE.BODY,
      },
    ];
    const code = options.errorCode ?? HTTP_ERROR_CODE.INVALID_REQUEST_BODY;
    throw new ValidationAppException(details, code, undefined, code);
  }

  return validateInput(schema, body, {
    ...options,
    source: VALIDATION_SOURCE.BODY,
  });
}

/**
 * Kiểm tra dữ liệu Query Parameters (`@Query()`).
 * Mặc định tự động loại bỏ các tham số truy vấn lạ không khai báo trong schema (`unknownFields: 'strip'`).
 */
export function validateQuery<T>(
  schema: z.ZodType<T>,
  query: unknown,
  options: Omit<ValidationOptions, 'source'> = {},
): T {
  return validateInput(schema, query, {
    ...options,
    source: VALIDATION_SOURCE.QUERY,
  });
}

/**
 * Kiểm tra dữ liệu Path Parameters (`@Param()`).
 * Gắn nhãn nguồn lỗi `source: 'params'` khi tham số đường dẫn không hợp lệ.
 */
export function validateParams<T>(
  schema: z.ZodType<T>,
  params: unknown,
  options: Omit<ValidationOptions, 'source'> = {},
): T {
  return validateInput(schema, params, {
    ...options,
    source: VALIDATION_SOURCE.PARAMS,
  });
}

/**
 * Schema kiểm tra tham số số thực (number) từ query string, từ chối chuỗi rỗng hoặc boolean.
 */
export function numericQueryParam(constraints?: { min?: number; max?: number }) {
  let numSchema = z.number();
  if (constraints?.min !== undefined) {
    numSchema = numSchema.min(constraints.min);
  }
  if (constraints?.max !== undefined) {
    numSchema = numSchema.max(constraints.max);
  }

  return z.preprocess((val) => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed.length === 0) return NaN;
      return Number(trimmed);
    }
    return val;
  }, numSchema);
}

/**
 * Schema kiểm tra tham số số nguyên (integer) từ query string.
 */
export function intQueryParam(constraints?: { min?: number; max?: number }) {
  let intSchema = z.number().int();
  if (constraints?.min !== undefined) {
    intSchema = intSchema.min(constraints.min);
  }
  if (constraints?.max !== undefined) {
    intSchema = intSchema.max(constraints.max);
  }

  return z.preprocess((val) => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed.length === 0) return NaN;
      return Number(trimmed);
    }
    return val;
  }, intSchema);
}

/**
 * Schema kiểm tra Path Parameter dạng UUID chuẩn (v1-v8).
 */
export const uuidParamSchema = z.string().trim().uuid('Path parameter must be a valid UUID');

/**
 * Schema kiểm tra Path Parameter dạng số nguyên dương (`>= 1`), tự động ép kiểu từ chuỗi URL sang `number`.
 */
export const positiveIntParamSchema = z
  .union([
    z.number().int().min(1),
    z
      .string()
      .trim()
      .regex(POSITIVE_INT_STRING_REGEX, 'Path parameter must be a positive integer')
      .transform((val) => Number.parseInt(val, 10)),
  ])
  .pipe(z.number().int().min(1));

export const intIdParamSchema = z.object({
  id: positiveIntParamSchema,
});

/**
 * Schema kiểm tra Path Parameter dạng chuỗi định danh Slug (`^[a-z0-9]+(?:-[a-z0-9]+)*$`).
 */
export const slugParamSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_SLUG_LENGTH)
  .regex(SLUG_REGEX, 'Path parameter must be a valid URL slug');

/**
 * Schema kiểm tra Path Parameter dạng chuỗi ID an toàn (không rỗng, chỉ chứa ký tự in được).
 */
export const printableIdParamSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_PARAM_ID_LENGTH)
  .refine(isPrintableString, {
    message: 'Path parameter contains invalid control characters',
  });

/**
 * Tạo Object Schema kiểm tra Path Parameter theo tên tham số trên route (mặc định là `id` kiểu UUID).
 */
export function createIdParamSchema<
  TKey extends string = 'id',
  TSchema extends z.ZodTypeAny = typeof uuidParamSchema,
>(paramName: TKey = 'id' as TKey, schema: TSchema = uuidParamSchema as unknown as TSchema) {
  return z.object({
    [paramName]: schema,
  } as Record<TKey, TSchema>);
}

/**
 * NestJS Validation Pipe dùng chung dựa trên Zod Schema.
 * Tự động nhận diện nguồn dữ liệu (`body`, `query`, `param`), loại bỏ hoặc chặn các trường không được phép gửi lên,
 * và ném `ValidationAppException` (400) chuẩn hóa khi thất bại.
 */
@Injectable()
export class ZodValidationPipe<T = unknown> implements PipeTransform<unknown, T> {
  /** Khởi tạo Pipe xác thực dữ liệu với Zod schema và tùy chọn chính sách trường lạ */
  constructor(
    private readonly schema: z.ZodType<T>,
    private readonly options: ValidationOptions = {},
  ) {}

  /** Biến đổi và kiểm tra tính hợp lệ của dữ liệu đầu vào theo ngữ cảnh tham số NestJS */
  public transform(value: unknown, metadata: ArgumentMetadata): T {
    const inferredSource: ValidationSource | undefined =
      this.options.source ??
      (metadata.type === 'body'
        ? VALIDATION_SOURCE.BODY
        : metadata.type === 'query'
          ? VALIDATION_SOURCE.QUERY
          : metadata.type === 'param'
            ? VALIDATION_SOURCE.PARAMS
            : undefined);

    // Trường hợp dùng @Param('id', new ZodValidationPipe(uuidParamSchema)) với scalar value
    // nhưng muốn báo lỗi đúng tên field 'id' trong details:
    if (metadata.data && !(this.schema instanceof z.ZodObject) && !isPlainObject(value)) {
      const wrappedSchema = z.object({ [metadata.data]: this.schema });
      const wrappedResult = validateInput(
        wrappedSchema,
        { [metadata.data]: value },
        {
          ...this.options,
          ...(inferredSource ? { source: inferredSource } : {}),
        },
      );
      return wrappedResult[metadata.data] as T;
    }

    if (inferredSource === VALIDATION_SOURCE.BODY) {
      return validateBody(this.schema, value, this.options);
    }

    if (inferredSource === VALIDATION_SOURCE.QUERY) {
      return validateQuery(this.schema, value, this.options);
    }

    if (inferredSource === VALIDATION_SOURCE.PARAMS) {
      return validateParams(this.schema, value, this.options);
    }

    return validateInput(this.schema, value, this.options);
  }
}

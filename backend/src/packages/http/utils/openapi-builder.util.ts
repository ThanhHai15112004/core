import { RequestMethod, type Type } from '@nestjs/common';
import { z } from 'zod';
import {
  HTTP_ERROR_CODE,
  HTTP_STATUS_CODE,
  PAGINATION_DEFAULTS,
  VALIDATION_SOURCE,
} from '@packages/kernel/index.js';
import {
  BEARER_SECURITY_SCHEME_NAME,
  type ApiDocOptions,
  type ApiGroupMetadata,
  type BuildOpenApiOptions,
  OPENAPI_VERSION,
  type OpenApiDocument,
  type OpenApiOperationObject,
  type OpenApiPaginationKind,
  type OpenApiParameterObject,
  type OpenApiPathItemObject,
  type OpenApiResponseObject,
  type OpenApiSchemaObject,
  type OpenApiTagObject,
  type PostmanCollection,
  type PostmanFolder,
  type PostmanItem,
  type RecordedValidationSchema,
} from '../contracts/api-docs.contract.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import {
  REQUIRED_PERMISSIONS_KEY,
  REQUIRED_ROLES_KEY,
} from '../decorators/permissions.decorator.js';
import {
  API_DOC_METADATA_KEY,
  API_DOC_VALIDATION_METADATA_KEY,
  API_GROUP_METADATA_KEY,
} from '../decorators/api-doc.decorator.js';
import { DEFAULT_API_PREFIX, normalizeApiPrefix } from './api-version.util.js';

const NEST_PATH_METADATA = 'path';
const NEST_METHOD_METADATA = 'method';
const NEST_HTTP_CODE_METADATA = '__httpCode__';
const NEST_MODULE_IMPORTS_METADATA = 'imports';
const NEST_MODULE_CONTROLLERS_METADATA = 'controllers';

/**
 * Duyệt đệ quy cây `@Module` của NestJS để thu thập toàn bộ danh sách các Controller Classes
 * mà không cần khởi tạo kết nối Database/Redis hay lắng nghe cổng mạng (cực nhanh cho CI/CD).
 */
export function collectControllersFromRootModule(rootModule: unknown): Array<Type<unknown>> {
  const visitedModules = new Set<unknown>();
  const controllerSet = new Set<Type<unknown>>();

  /** Duyệt đệ quy một node Module hoặc DynamicModule */
  const visit = (modOrDynamic: unknown): void => {
    if (!modOrDynamic || visitedModules.has(modOrDynamic)) {
      return;
    }
    visitedModules.add(modOrDynamic);

    if (typeof modOrDynamic === 'function') {
      const controllers =
        (Reflect.getMetadata(NEST_MODULE_CONTROLLERS_METADATA, modOrDynamic) as
          Array<Type<unknown>> | undefined) ?? [];
      for (const ctrl of controllers) {
        if (typeof ctrl === 'function') {
          controllerSet.add(ctrl);
        }
      }

      const imports =
        (Reflect.getMetadata(NEST_MODULE_IMPORTS_METADATA, modOrDynamic) as
          unknown[] | undefined) ?? [];
      for (const imported of imports) {
        visit(imported);
      }
      return;
    }

    if (typeof modOrDynamic === 'object') {
      const dyn = modOrDynamic as {
        module?: unknown;
        imports?: unknown[];
        controllers?: Array<Type<unknown>>;
      };
      if (Array.isArray(dyn.controllers)) {
        for (const ctrl of dyn.controllers) {
          if (typeof ctrl === 'function') {
            controllerSet.add(ctrl);
          }
        }
      }
      if (Array.isArray(dyn.imports)) {
        for (const imported of dyn.imports) {
          visit(imported);
        }
      }
      if (dyn.module) {
        visit(dyn.module);
      }
    }
  };

  visit(rootModule);
  return [...controllerSet];
}

const EXAMPLE_UUID = '550e8400-e29b-41d4-a716-446655440000';
const EXAMPLE_EMAIL = 'user@example.com';
const EXAMPLE_TIMESTAMP = '2026-10-14T10:00:00.000Z';
const EXAMPLE_URL = 'https://example.com/resource';
const EXAMPLE_SLUG = 'core-resource-item';

const REQUEST_METHOD_MAP: Readonly<
  Partial<Record<RequestMethod, 'get' | 'post' | 'put' | 'patch' | 'delete'>>
> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

/**
 * Bóc tách các lớp bọc `ZodPipe` / `ZodDefault` / `ZodOptional` / `ZodNullable`
 * để lấy ra schema có kiểu dữ liệu rõ ràng nhất phục vụ sinh OpenAPI Schema.
 */
function unwrapPipeSchema(schema: z.ZodTypeAny): {
  coreSchema: z.ZodTypeAny;
  isOptional: boolean;
  defaultValue?: unknown;
} {
  let current: z.ZodTypeAny = schema;
  let isOptional = false;
  let defaultValue: unknown = undefined;

  for (let depth = 0; depth < 10; depth++) {
    if (current instanceof z.ZodOptional) {
      isOptional = true;
      current = current.unwrap() as z.ZodTypeAny;
      continue;
    }
    if (current instanceof z.ZodDefault) {
      isOptional = true;
      const defVal = (current as unknown as { _def: { defaultValue: unknown } })._def.defaultValue;
      defaultValue = typeof defVal === 'function' ? (defVal as () => unknown)() : defVal;
      current = current.removeDefault() as z.ZodTypeAny;
      continue;
    }
    if (current instanceof z.ZodPipe) {
      const pipeDef = (current as unknown as { _def: { in: z.ZodTypeAny; out: z.ZodTypeAny } })
        ._def;
      // Nếu nhánh in là ZodTransform (từ z.preprocess), ưu tiên lấy nhánh out có kiểu tường minh
      if (pipeDef.in instanceof z.ZodTransform) {
        current = pipeDef.out;
        continue;
      }
      // Nếu nhánh out là kiểu đích cụ thể (vd z.number().int().min(1))
      if (!(pipeDef.out instanceof z.ZodTransform)) {
        current = pipeDef.out;
        continue;
      }
      current = pipeDef.in;
      continue;
    }
    break;
  }

  return {
    coreSchema: current,
    isOptional,
    ...(defaultValue !== undefined ? { defaultValue } : {}),
  };
}

/**
 * Chuyển đổi một Zod v4 Schema bất kỳ sang `OpenApiSchemaObject` chuẩn OpenAPI 3.1.
 * Tận dụng `z.toJSONSchema()` có sẵn trong Zod v4 kết hợp xử lý đệ quy cho `z.preprocess` / `ZodPipe`.
 */
export function zodSchemaToOpenApiSchema(schema: z.ZodTypeAny): OpenApiSchemaObject {
  const { coreSchema, defaultValue } = unwrapPipeSchema(schema);

  if (coreSchema instanceof z.ZodObject) {
    const shape = coreSchema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, OpenApiSchemaObject> = {};
    const required: string[] = [];

    for (const [key, fieldSchema] of Object.entries(shape)) {
      const unwrapped = unwrapPipeSchema(fieldSchema);
      properties[key] = zodSchemaToOpenApiSchema(fieldSchema);
      if (!unwrapped.isOptional && !fieldSchema.isOptional()) {
        required.push(key);
      }
    }

    const meta = typeof coreSchema.meta === 'function' ? coreSchema.meta() : undefined;
    return {
      type: 'object',
      properties,
      ...(required.length > 0 ? { required } : {}),
      ...(coreSchema.description ? { description: coreSchema.description } : {}),
      ...(meta && typeof meta === 'object' && 'example' in meta ? { example: meta.example } : {}),
    };
  }

  if (coreSchema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodSchemaToOpenApiSchema(coreSchema.element as z.ZodTypeAny),
      ...(coreSchema.description ? { description: coreSchema.description } : {}),
    };
  }

  try {
    const rawJson = z.toJSONSchema(coreSchema, {
      unrepresentable: 'any',
    }) as Record<string, unknown>;

    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rawJson)) {
      if (k === '$schema') continue;
      cleaned[k] = v;
    }

    if (defaultValue !== undefined && cleaned['default'] === undefined) {
      cleaned['default'] = defaultValue;
    }
    if (schema.description && cleaned['description'] === undefined) {
      cleaned['description'] = schema.description;
    }

    const meta = typeof schema.meta === 'function' ? schema.meta() : undefined;
    if (meta && typeof meta === 'object' && 'example' in meta && cleaned['example'] === undefined) {
      cleaned['example'] = meta.example;
    }

    if (
      cleaned['type'] === undefined &&
      cleaned['anyOf'] === undefined &&
      cleaned['enum'] === undefined
    ) {
      cleaned['type'] = 'string';
    }

    return cleaned as OpenApiSchemaObject;
  } catch {
    return {
      type: 'string',
      ...(defaultValue !== undefined ? { default: defaultValue } : {}),
      ...(schema.description ? { description: schema.description } : {}),
    };
  }
}

/**
 * Tự động sinh dữ liệu mẫu (Example) thông minh từ `OpenApiSchemaObject` và tên trường.
 */
export function generateSchemaExample(schema: OpenApiSchemaObject, fieldName = ''): unknown {
  if (schema.example !== undefined) {
    return schema.example;
  }
  if (schema.default !== undefined) {
    return schema.default;
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const nonNullBranch = schema.anyOf.find((b) => b.type !== 'null') ?? schema.anyOf[0]!;
    return generateSchemaExample(nonNullBranch, fieldName);
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return generateSchemaExample(schema.oneOf[0]!, fieldName);
  }

  const schemaType = Array.isArray(schema.type)
    ? (schema.type.find((t) => t !== 'null') ?? 'string')
    : schema.type;

  if (schemaType === 'object' || schema.properties) {
    const result: Record<string, unknown> = {};
    const props = schema.properties ?? {};
    for (const [key, propSchema] of Object.entries(props)) {
      result[key] = generateSchemaExample(propSchema, key);
    }
    return result;
  }

  if (schemaType === 'array') {
    const itemSchema = schema.items ?? { type: 'string' };
    return [generateSchemaExample(itemSchema, fieldName)];
  }

  if (schemaType === 'integer' || schemaType === 'number') {
    const lowerName = fieldName.toLowerCase();
    if (lowerName === 'page') return PAGINATION_DEFAULTS.PAGE;
    if (lowerName === 'limit' || lowerName === 'count') return PAGINATION_DEFAULTS.LIMIT;
    if (typeof schema.minimum === 'number') return schema.minimum;
    return 1;
  }

  if (schemaType === 'boolean') {
    return true;
  }

  const lowerField = fieldName.toLowerCase();
  if (schema.format === 'uuid' || lowerField === 'id' || lowerField.endsWith('id')) {
    return EXAMPLE_UUID;
  }
  if (schema.format === 'email' || lowerField.includes('email')) {
    return EXAMPLE_EMAIL;
  }
  if (schema.format === 'date-time' || lowerField.endsWith('at') || lowerField === 'timestamp') {
    return EXAMPLE_TIMESTAMP;
  }
  if (schema.format === 'uri' || schema.format === 'url' || lowerField.includes('url')) {
    return EXAMPLE_URL;
  }
  if (lowerField.includes('slug')) {
    return EXAMPLE_SLUG;
  }

  return fieldName ? `${fieldName}_sample` : 'sample_value';
}

/**
 * Xây dựng Schema chuẩn cho vỏ phản hồi thành công (`ApiSuccessResponse` / `ApiPaginatedResponse`).
 */
export function buildSuccessEnvelopeSchema(
  dataSchema: OpenApiSchemaObject,
  statusCode: number = HTTP_STATUS_CODE.OK,
  pagination?: OpenApiPaginationKind,
  explicitDataExample?: unknown,
): { schema: OpenApiSchemaObject; example: Record<string, unknown> } {
  const effectiveDataSchema: OpenApiSchemaObject = pagination
    ? {
        type: 'array',
        items: dataSchema,
      }
    : dataSchema;

  const dataExample =
    explicitDataExample !== undefined
      ? explicitDataExample
      : generateSchemaExample(effectiveDataSchema, 'data');

  const metaSchema: OpenApiSchemaObject | undefined =
    pagination === 'offset'
      ? {
          type: 'object',
          required: ['page', 'limit', 'total', 'totalPages', 'hasNextPage', 'hasPrevPage'],
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
            total: { type: 'integer', nullable: true, example: 100 },
            totalPages: { type: 'integer', nullable: true, example: 5 },
            hasNextPage: { type: 'boolean', example: true },
            hasPrevPage: { type: 'boolean', example: false },
          },
        }
      : pagination === 'cursor'
        ? {
            type: 'object',
            required: ['limit', 'nextCursor', 'prevCursor', 'hasNextPage', 'hasPrevPage'],
            properties: {
              limit: { type: 'integer', example: 20 },
              nextCursor: { type: 'string', nullable: true, example: 'eyJ2IjoxLCJpZCI6IjEifQ' },
              prevCursor: { type: 'string', nullable: true, example: null },
              hasNextPage: { type: 'boolean', example: true },
              hasPrevPage: { type: 'boolean', example: false },
            },
          }
        : undefined;

  const metaExample = metaSchema ? generateSchemaExample(metaSchema, 'meta') : undefined;

  const schema: OpenApiSchemaObject = {
    type: 'object',
    required: ['success', 'statusCode', 'data', ...(metaSchema ? ['meta'] : []), 'timestamp'],
    properties: {
      success: { type: 'boolean', enum: [true], example: true },
      statusCode: { type: 'integer', example: statusCode },
      data: effectiveDataSchema,
      ...(metaSchema ? { meta: metaSchema } : {}),
      timestamp: { type: 'string', format: 'date-time', example: EXAMPLE_TIMESTAMP },
    },
  };

  const example: Record<string, unknown> = {
    success: true,
    statusCode,
    data: dataExample,
    ...(metaExample !== undefined ? { meta: metaExample } : {}),
    timestamp: EXAMPLE_TIMESTAMP,
  };

  return { schema, example };
}

/**
 * Xây dựng Schema chuẩn cho vỏ phản hồi lỗi (`ApiErrorResponse`) của `GlobalExceptionFilter`.
 */
export function buildErrorEnvelopeSchema(
  statusCode: number,
  errorCode: string,
  description: string,
  includeValidationDetails = false,
): OpenApiResponseObject {
  const detailsExample = includeValidationDetails
    ? [
        {
          field: 'fieldName',
          message: 'Invalid input value',
          code: 'invalid_type',
          source: 'body',
        },
      ]
    : undefined;

  const schema: OpenApiSchemaObject = {
    type: 'object',
    required: ['success', 'statusCode', 'error', 'timestamp'],
    properties: {
      success: { type: 'boolean', enum: [false], example: false },
      statusCode: { type: 'integer', example: statusCode },
      error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string', example: errorCode },
          message: { type: 'string', example: description },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                message: { type: 'string' },
                code: { type: 'string' },
                source: { type: 'string', enum: ['body', 'query', 'params'] },
              },
            },
          },
        },
      },
      timestamp: { type: 'string', format: 'date-time', example: EXAMPLE_TIMESTAMP },
    },
  };

  const example = {
    success: false,
    statusCode,
    error: {
      code: errorCode,
      message: description,
      ...(detailsExample ? { details: detailsExample } : {}),
    },
    timestamp: EXAMPLE_TIMESTAMP,
  };

  return {
    description,
    content: {
      'application/json': {
        schema,
        example,
      },
    },
  };
}

/**
 * Chuẩn hóa đường dẫn NestJS (`/ops/jobs/:id`) sang định dạng chuẩn OpenAPI (`/api/v1/ops/jobs/{id}`).
 */
export function normalizeOpenApiPath(
  controllerPath: string,
  methodPath: string,
  apiPrefix: string = DEFAULT_API_PREFIX,
): { openApiPath: string; pathParamNames: string[] } {
  const cleanPrefix = normalizeApiPrefix(apiPrefix);
  const segments = [cleanPrefix, controllerPath, methodPath]
    .map((part) => part.trim().replace(/^\/+|\/+$/g, ''))
    .filter((part) => part.length > 0);

  const combined = `/${segments.join('/')}`;
  const pathParamNames: string[] = [];

  const openApiPath = combined.replace(/:([A-Za-z0-9_]+)/g, (_match, paramName: string) => {
    pathParamNames.push(paramName);
    return `{${paramName}}`;
  });

  return { openApiPath, pathParamNames };
}

/**
 * Chuyển đổi tên class Controller sang tên Tag mặc định dễ đọc (vd `JobsOpsController` -> `Jobs Ops`).
 */
function inferTagFromControllerName(controllerName: string): string {
  const withoutSuffix = controllerName.replace(/Controller$/, '');
  const spaced = withoutSuffix.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
  return spaced.length > 0 ? spaced : 'General';
}

/**
 * Tạo bảng Markdown mô tả cơ chế xác thực và quyền hạn yêu cầu của API.
 */
function buildSecurityDescriptionBlock(
  isPublic: boolean,
  roles: readonly string[],
  permissions: readonly string[],
): string {
  const lines: string[] = ['### 🔐 Xác thực & Phân quyền (Access Control)'];

  if (isPublic) {
    lines.push('- **Chế độ truy cập**: `Public` (Không yêu cầu đăng nhập)');
    return lines.join('\n');
  }

  lines.push('- **Xác thực**: `Bearer JWT Token` (`Authorization: Bearer <token>`)');
  if (roles.length > 0) {
    lines.push(`- **Vai trò yêu cầu (Roles)**: ${roles.map((r) => `\`${r}\``).join(', ')}`);
  }
  if (permissions.length > 0) {
    lines.push(
      `- **Quyền hạn yêu cầu (Permissions)**: ${permissions.map((p) => `\`${p}\``).join(', ')}`,
    );
  }

  return lines.join('\n');
}

/**
 * Chuyển một Zod Schema của `@Query()` hoặc `@Param()` thành danh sách `OpenApiParameterObject`.
 */
function extractOpenApiParameters(
  schema: z.ZodTypeAny | undefined,
  location: 'query' | 'path',
  scalarParamKey?: string,
): OpenApiParameterObject[] {
  if (!schema) {
    return [];
  }

  const { coreSchema } = unwrapPipeSchema(schema);

  if (coreSchema instanceof z.ZodObject) {
    const shape = coreSchema.shape as Record<string, z.ZodTypeAny>;
    const params: OpenApiParameterObject[] = [];

    for (const [name, fieldSchema] of Object.entries(shape)) {
      const unwrapped = unwrapPipeSchema(fieldSchema);
      const paramSchema = zodSchemaToOpenApiSchema(fieldSchema);
      const isRequired =
        location === 'path' ? true : !unwrapped.isOptional && !fieldSchema.isOptional();

      params.push({
        name,
        in: location,
        required: isRequired,
        ...(paramSchema.description ? { description: paramSchema.description } : {}),
        schema: paramSchema,
        example: generateSchemaExample(paramSchema, name),
      });
    }

    return params;
  }

  if (scalarParamKey) {
    const paramSchema = zodSchemaToOpenApiSchema(schema);
    return [
      {
        name: scalarParamKey,
        in: location,
        required: location === 'path' ? true : !schema.isOptional(),
        ...(paramSchema.description ? { description: paramSchema.description } : {}),
        schema: paramSchema,
        example: generateSchemaExample(paramSchema, scalarParamKey),
      },
    ];
  }

  return [];
}

/**
 * Quét danh sách các Controller Classes và sinh tài liệu chuẩn OpenAPI 3.1.0.
 * Tự động kết hợp metadata từ `@Controller`, `@Get/@Post/...`, `@Public`, `@RequirePermissions`, `@RequireRoles`,
 * `@ValidatedBody/@ValidatedQuery/@ValidatedParams` và `@ApiGroup/@ApiDoc`.
 */
export function buildOpenApiDocumentFromControllers(
  controllerClasses: ReadonlyArray<Type<unknown>>,
  options: BuildOpenApiOptions = {},
): OpenApiDocument {
  const apiPrefix = options.apiPrefix ?? DEFAULT_API_PREFIX;
  const tagMap = new Map<string, OpenApiTagObject>();
  const rawPaths = new Map<string, Record<string, OpenApiOperationObject>>();

  for (const controllerClass of controllerClasses) {
    const controllerPathRaw = Reflect.getMetadata(NEST_PATH_METADATA, controllerClass) as
      string | string[] | undefined;
    if (controllerPathRaw === undefined) {
      continue;
    }

    const controllerPath = Array.isArray(controllerPathRaw)
      ? (controllerPathRaw[0] ?? '')
      : controllerPathRaw;

    const groupMeta = Reflect.getMetadata(API_GROUP_METADATA_KEY, controllerClass) as
      ApiGroupMetadata | undefined;
    const defaultTag = groupMeta?.name ?? inferTagFromControllerName(controllerClass.name);

    if (!tagMap.has(defaultTag)) {
      tagMap.set(defaultTag, {
        name: defaultTag,
        ...(groupMeta?.description ? { description: groupMeta.description } : {}),
      });
    }

    const classPublic = Boolean(Reflect.getMetadata(IS_PUBLIC_KEY, controllerClass));
    const classRoles =
      (Reflect.getMetadata(REQUIRED_ROLES_KEY, controllerClass) as readonly string[] | undefined) ??
      [];
    const classPermissions =
      (Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controllerClass) as
        readonly string[] | undefined) ?? [];

    const prototype = controllerClass.prototype as Record<string, unknown>;
    const methodNames = Object.getOwnPropertyNames(prototype).filter(
      (name) => name !== 'constructor' && typeof prototype[name] === 'function',
    );

    for (const methodName of methodNames) {
      const handler = prototype[methodName] as object;
      const requestMethod = Reflect.getMetadata(NEST_METHOD_METADATA, handler) as
        RequestMethod | undefined;
      if (requestMethod === undefined) {
        continue;
      }

      const httpVerb = REQUEST_METHOD_MAP[requestMethod];
      if (!httpVerb) {
        continue;
      }

      const methodPathRaw = Reflect.getMetadata(NEST_PATH_METADATA, handler) as
        string | string[] | undefined;
      const methodPath = Array.isArray(methodPathRaw)
        ? (methodPathRaw[0] ?? '')
        : (methodPathRaw ?? '');

      const { openApiPath, pathParamNames } = normalizeOpenApiPath(
        controllerPath,
        methodPath,
        apiPrefix,
      );

      const docOptions =
        (Reflect.getMetadata(API_DOC_METADATA_KEY, handler) as ApiDocOptions | undefined) ?? {};
      const recordedValidations =
        (Reflect.getMetadata(API_DOC_VALIDATION_METADATA_KEY, handler) as
          readonly RecordedValidationSchema[] | undefined) ?? [];

      const methodPublic = Reflect.getMetadata(IS_PUBLIC_KEY, handler) as boolean | undefined;
      const isPublic = methodPublic !== undefined ? methodPublic : classPublic;

      const methodRoles =
        (Reflect.getMetadata(REQUIRED_ROLES_KEY, handler) as readonly string[] | undefined) ??
        classRoles;
      const methodPermissions =
        (Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, handler) as readonly string[] | undefined) ??
        classPermissions;

      const tag = docOptions.group ?? defaultTag;
      if (!tagMap.has(tag)) {
        tagMap.set(tag, { name: tag });
      }

      // 1. Tổng hợp Path Parameters & Query Parameters
      const parameters: OpenApiParameterObject[] = [];
      const seenPathParams = new Set<string>();

      if (docOptions.params) {
        for (const p of extractOpenApiParameters(docOptions.params, 'path')) {
          seenPathParams.add(p.name);
          parameters.push(p);
        }
      }

      for (const rec of recordedValidations) {
        if (rec.source === VALIDATION_SOURCE.PARAMS) {
          for (const p of extractOpenApiParameters(rec.schema, 'path', rec.paramKey)) {
            if (!seenPathParams.has(p.name)) {
              seenPathParams.add(p.name);
              parameters.push(p);
            }
          }
        }
      }

      // Tự động điền các tham số :param trên route path nếu chưa có schema tường minh
      for (const paramName of pathParamNames) {
        if (!seenPathParams.has(paramName)) {
          seenPathParams.add(paramName);
          const fallbackSchema: OpenApiSchemaObject = { type: 'string', minLength: 1 };
          parameters.push({
            name: paramName,
            in: 'path',
            required: true,
            schema: fallbackSchema,
            example: generateSchemaExample(fallbackSchema, paramName),
          });
        }
      }

      const seenQueryParams = new Set<string>();
      const querySchema =
        docOptions.query ??
        recordedValidations.find((r) => r.source === VALIDATION_SOURCE.QUERY)?.schema;

      if (querySchema) {
        for (const q of extractOpenApiParameters(querySchema, 'query')) {
          if (!seenQueryParams.has(q.name)) {
            seenQueryParams.add(q.name);
            parameters.push(q);
          }
        }
      }

      // 2. Tổng hợp Request Body
      const bodySchemaZod =
        docOptions.body ??
        recordedValidations.find((r) => r.source === VALIDATION_SOURCE.BODY)?.schema;

      const bodyOpenApiSchema = bodySchemaZod ? zodSchemaToOpenApiSchema(bodySchemaZod) : undefined;
      const bodyExample = bodyOpenApiSchema
        ? (docOptions.requestExample ?? generateSchemaExample(bodyOpenApiSchema, 'body'))
        : undefined;

      // 3. Tổng hợp Responses (Success Envelope + Error Envelopes)
      const explicitHttpCode = Reflect.getMetadata(NEST_HTTP_CODE_METADATA, handler) as
        number | undefined;
      const successStatus =
        docOptions.status ??
        explicitHttpCode ??
        (httpVerb === 'post' ? HTTP_STATUS_CODE.CREATED : HTTP_STATUS_CODE.OK);

      const responses: Record<string, OpenApiResponseObject> = {};

      if (successStatus === HTTP_STATUS_CODE.NO_CONTENT) {
        responses[String(HTTP_STATUS_CODE.NO_CONTENT)] = {
          description: 'No Content',
        };
      } else {
        const dataSchema = docOptions.response
          ? zodSchemaToOpenApiSchema(docOptions.response)
          : ({ type: 'object', additionalProperties: true } satisfies OpenApiSchemaObject);

        const envelope = buildSuccessEnvelopeSchema(
          dataSchema,
          successStatus,
          docOptions.pagination,
          docOptions.responseExample,
        );

        responses[String(successStatus)] = {
          description: 'Success Response Envelope',
          content: {
            'application/json': {
              schema: envelope.schema,
              example: envelope.example,
            },
          },
        };
      }

      const hasInputValidation = Boolean(bodyOpenApiSchema || parameters.length > 0);
      if (
        hasInputValidation ||
        (docOptions.errorCodes ?? []).includes(HTTP_ERROR_CODE.VALIDATION_FAILED)
      ) {
        responses[String(HTTP_STATUS_CODE.BAD_REQUEST)] = buildErrorEnvelopeSchema(
          HTTP_STATUS_CODE.BAD_REQUEST,
          HTTP_ERROR_CODE.VALIDATION_FAILED,
          'Dữ liệu đầu vào không hợp lệ',
          true,
        );
      }

      if (!isPublic) {
        responses[String(HTTP_STATUS_CODE.UNAUTHORIZED)] = buildErrorEnvelopeSchema(
          HTTP_STATUS_CODE.UNAUTHORIZED,
          HTTP_ERROR_CODE.UNAUTHORIZED,
          'Chưa xác thực hoặc JWT token không hợp lệ',
        );
      }

      if (
        methodRoles.length > 0 ||
        methodPermissions.length > 0 ||
        (docOptions.errorCodes ?? []).includes(HTTP_ERROR_CODE.FORBIDDEN)
      ) {
        responses[String(HTTP_STATUS_CODE.FORBIDDEN)] = buildErrorEnvelopeSchema(
          HTTP_STATUS_CODE.FORBIDDEN,
          HTTP_ERROR_CODE.FORBIDDEN,
          'Không đủ quyền hạn (Roles/Permissions) để thực hiện thao tác',
        );
      }

      if (
        pathParamNames.length > 0 ||
        (docOptions.errorCodes ?? []).includes(HTTP_ERROR_CODE.NOT_FOUND)
      ) {
        responses[String(HTTP_STATUS_CODE.NOT_FOUND)] = buildErrorEnvelopeSchema(
          HTTP_STATUS_CODE.NOT_FOUND,
          HTTP_ERROR_CODE.NOT_FOUND,
          'Không tìm thấy tài nguyên yêu cầu',
        );
      }

      if ((docOptions.errorCodes ?? []).includes(HTTP_ERROR_CODE.CONFLICT)) {
        responses[String(HTTP_STATUS_CODE.CONFLICT)] = buildErrorEnvelopeSchema(
          HTTP_STATUS_CODE.CONFLICT,
          HTTP_ERROR_CODE.CONFLICT,
          'Xung đột trạng thái dữ liệu',
        );
      }

      responses[String(HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR)] = buildErrorEnvelopeSchema(
        HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR,
        HTTP_ERROR_CODE.INTERNAL_SERVER_ERROR,
        'Lỗi hệ thống nội bộ',
      );

      // 4. Mô tả chi tiết + Bảng phân quyền
      const securityBlock = buildSecurityDescriptionBlock(isPublic, methodRoles, methodPermissions);
      const fullDescription = docOptions.description
        ? `${docOptions.description}\n\n${securityBlock}`
        : securityBlock;

      const summary =
        docOptions.summary ?? `${httpVerb.toUpperCase()} ${openApiPath} (${methodName})`;

      const operation: OpenApiOperationObject = {
        operationId: `${controllerClass.name}_${methodName}`,
        summary,
        description: fullDescription,
        tags: [tag],
        ...(docOptions.deprecated ? { deprecated: true } : {}),
        security: isPublic ? [] : [{ [BEARER_SECURITY_SCHEME_NAME]: [] }],
        ...(parameters.length > 0 ? { parameters } : {}),
        ...(bodyOpenApiSchema
          ? {
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: bodyOpenApiSchema,
                    example: bodyExample,
                  },
                },
              },
            }
          : {}),
        responses,
        'x-public': isPublic,
        ...(methodPermissions.length > 0 ? { 'x-required-permissions': methodPermissions } : {}),
        ...(methodRoles.length > 0 ? { 'x-required-roles': methodRoles } : {}),
      };

      const existingPathItem = rawPaths.get(openApiPath) ?? {};
      existingPathItem[httpVerb] = operation;
      rawPaths.set(openApiPath, existingPathItem);
    }
  }

  // Sắp xếp cố định (deterministic sort) để xuất file OpenAPI trong CI không bị thay đổi thứ tự
  const sortedPaths: Record<string, OpenApiPathItemObject> = {};
  for (const pathKey of [...rawPaths.keys()].sort()) {
    sortedPaths[pathKey] = rawPaths.get(pathKey) as OpenApiPathItemObject;
  }

  const sortedTags = [...tagMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  return {
    openapi: OPENAPI_VERSION,
    info: {
      title: options.title ?? 'Core Framework HTTP API',
      version: options.version ?? '1.0.0',
      description:
        options.description ??
        'Tài liệu đặc tả API chuẩn OpenAPI 3.1.0 được trích xuất tự động từ Zod v4 Schema, Route Metadata và Security Guards.',
    },
    servers: [
      {
        url: options.serverUrl ?? '/',
        description: 'Current API Server',
      },
    ],
    tags: sortedTags,
    paths: sortedPaths,
    components: {
      securitySchemes: {
        [BEARER_SECURITY_SCHEME_NAME]: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Nhập JWT Access Token theo định dạng: Bearer <access_token>',
        },
      },
      schemas: {
        ApiErrorEnvelope: {
          type: 'object',
          required: ['code', 'message'],
          properties: {
            code: { type: 'string', example: HTTP_ERROR_CODE.VALIDATION_FAILED },
            message: { type: 'string', example: 'Dữ liệu không vượt qua kiểm tra hợp lệ' },
            details: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  message: { type: 'string' },
                  code: { type: 'string' },
                  source: { type: 'string', enum: ['body', 'query', 'params'] },
                },
              },
            },
          },
        },
      },
    },
  };
}

/**
 * Chuyển đổi tài liệu `OpenApiDocument` sang chuẩn `PostmanCollection` v2.1.0.
 */
export function convertOpenApiToPostmanCollection(doc: OpenApiDocument): PostmanCollection {
  const folderMap = new Map<string, PostmanItem[]>();

  for (const [pathStr, pathItem] of Object.entries(doc.paths)) {
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const;
    for (const method of methods) {
      const op = pathItem[method];
      if (!op) continue;

      const folderName = op.tags[0] ?? 'General';
      const items = folderMap.get(folderName) ?? [];

      const postmanPathSegments = pathStr
        .split('/')
        .filter((s) => s.length > 0)
        .map((seg) => seg.replace(/^\{(.+)\}$/, ':$1'));

      const queryParams = (op.parameters ?? [])
        .filter((p) => p.in === 'query')
        .map((p) => ({
          key: p.name,
          value: p.example !== undefined ? String(p.example) : '',
          ...(p.description ? { description: p.description } : {}),
        }));

      const queryString =
        queryParams.length > 0
          ? `?${queryParams.map((q) => `${q.key}=${encodeURIComponent(q.value)}`).join('&')}`
          : '';

      const headers: Array<{ key: string; value: string }> = [
        { key: 'Accept', value: 'application/json' },
      ];
      if (!op['x-public']) {
        headers.push({ key: 'Authorization', value: 'Bearer {{bearerToken}}' });
      }
      if (op.requestBody) {
        headers.push({ key: 'Content-Type', value: 'application/json' });
      }

      const bodyExample = op.requestBody?.content['application/json']?.example;

      items.push({
        name: op.summary,
        request: {
          method: method.toUpperCase(),
          header: headers,
          url: {
            raw: `{{baseUrl}}/${postmanPathSegments.join('/')}${queryString}`,
            host: ['{{baseUrl}}'],
            path: postmanPathSegments,
            ...(queryParams.length > 0 ? { query: queryParams } : {}),
          },
          ...(bodyExample !== undefined
            ? {
                body: {
                  mode: 'raw',
                  raw: JSON.stringify(bodyExample, null, 2),
                  options: { raw: { language: 'json' } },
                },
              }
            : {}),
          ...(op.description ? { description: op.description } : {}),
        },
      });

      folderMap.set(folderName, items);
    }
  }

  const folders: PostmanFolder[] = [...folderMap.entries()].map(([name, item]) => ({
    name,
    item,
  }));

  return {
    info: {
      name: doc.info.title,
      description: doc.info.description,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      { key: 'baseUrl', value: 'http://localhost:4000' },
      { key: 'bearerToken', value: 'your_jwt_access_token_here' },
    ],
    item: folders,
  };
}

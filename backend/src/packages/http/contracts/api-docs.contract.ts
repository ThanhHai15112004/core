import type { z } from 'zod';
import type { ValidationSource } from '@packages/kernel/index.js';

export const OPENAPI_VERSION = '3.1.0' as const;
export const DEFAULT_API_DOCS_PATH = 'docs' as const;
export const BEARER_SECURITY_SCHEME_NAME = 'bearerAuth' as const;

export type OpenApiPaginationKind = 'offset' | 'cursor';

export interface ApiGroupMetadata {
  readonly name: string;
  readonly description?: string;
}

export interface ApiDocOptions {
  /** Tiêu đề ngắn gọn của endpoint hiển thị trên danh mục Scalar UI */
  readonly summary?: string;
  /** Mô tả chi tiết hành vi nghiệp vụ của endpoint (hỗ trợ Markdown) */
  readonly description?: string;
  /** Tên nhóm (Tag) hiển thị trên sidebar (ghi đè `@ApiGroup` của Controller nếu có) */
  readonly group?: string;
  /** Zod Schema mô tả các tham số trên đường dẫn (`@Param`) */
  readonly params?: z.ZodTypeAny;
  /** Zod Schema mô tả các tham số truy vấn (`@Query`) */
  readonly query?: z.ZodTypeAny;
  /** Zod Schema mô tả dữ liệu thân yêu cầu (`@Body`) */
  readonly body?: z.ZodTypeAny;
  /** Zod Schema mô tả phần dữ liệu `data` trong phản hồi thành công */
  readonly response?: z.ZodTypeAny;
  /** Chế độ phân trang của dữ liệu trả về (`'offset'` hoặc `'cursor'`) */
  readonly pagination?: OpenApiPaginationKind;
  /** Mã trạng thái HTTP khi thành công (mặc định: 200 hoặc 201 với POST) */
  readonly status?: number;
  /** Ví dụ dữ liệu mẫu cho Request Body */
  readonly requestExample?: unknown;
  /** Ví dụ dữ liệu mẫu cho phần `data` của Response */
  readonly responseExample?: unknown;
  /** Danh sách các mã lỗi nghiệp vụ/hệ thống có thể phát sinh tại endpoint này */
  readonly errorCodes?: readonly string[];
  /** Đánh dấu endpoint đã lỗi thời (deprecated) */
  readonly deprecated?: boolean;
}

export interface RecordedValidationSchema {
  readonly source: ValidationSource;
  readonly schema: z.ZodTypeAny;
  readonly paramKey?: string;
}

export interface OpenApiSchemaObject {
  readonly type?: string | readonly string[];
  readonly format?: string;
  readonly description?: string;
  readonly properties?: Record<string, OpenApiSchemaObject>;
  readonly required?: readonly string[];
  readonly items?: OpenApiSchemaObject;
  readonly enum?: readonly unknown[];
  readonly default?: unknown;
  readonly example?: unknown;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly nullable?: boolean;
  readonly additionalProperties?: boolean | OpenApiSchemaObject;
  readonly oneOf?: readonly OpenApiSchemaObject[];
  readonly anyOf?: readonly OpenApiSchemaObject[];
  readonly allOf?: readonly OpenApiSchemaObject[];
  readonly [key: string]: unknown;
}

export interface OpenApiParameterObject {
  readonly name: string;
  readonly in: 'path' | 'query' | 'header';
  readonly required: boolean;
  readonly description?: string;
  readonly schema: OpenApiSchemaObject;
  readonly example?: unknown;
}

export interface OpenApiMediaTypeObject {
  readonly schema: OpenApiSchemaObject;
  readonly example?: unknown;
}

export interface OpenApiRequestBodyObject {
  readonly required: boolean;
  readonly description?: string;
  readonly content: {
    readonly 'application/json': OpenApiMediaTypeObject;
  };
}

export interface OpenApiResponseObject {
  readonly description: string;
  readonly content?: {
    readonly 'application/json': OpenApiMediaTypeObject;
  };
}

export interface OpenApiOperationObject {
  readonly operationId: string;
  readonly summary: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly deprecated?: boolean;
  readonly security: ReadonlyArray<Record<string, readonly string[]>>;
  readonly parameters?: readonly OpenApiParameterObject[];
  readonly requestBody?: OpenApiRequestBodyObject;
  readonly responses: Record<string, OpenApiResponseObject>;
  readonly 'x-public'?: boolean;
  readonly 'x-required-permissions'?: readonly string[];
  readonly 'x-required-roles'?: readonly string[];
}

export type OpenApiPathItemObject = Partial<
  Record<'get' | 'post' | 'put' | 'patch' | 'delete', OpenApiOperationObject>
>;

export interface OpenApiTagObject {
  readonly name: string;
  readonly description?: string;
}

export interface OpenApiDocument {
  readonly openapi: typeof OPENAPI_VERSION;
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description: string;
  };
  readonly servers: ReadonlyArray<{
    readonly url: string;
    readonly description: string;
  }>;
  readonly tags: readonly OpenApiTagObject[];
  readonly paths: Record<string, OpenApiPathItemObject>;
  readonly components: {
    readonly securitySchemes: Record<
      string,
      {
        readonly type: 'http';
        readonly scheme: 'bearer';
        readonly bearerFormat: 'JWT';
        readonly description: string;
      }
    >;
    readonly schemas: Record<string, OpenApiSchemaObject>;
  };
}

export interface BuildOpenApiOptions {
  readonly title?: string;
  readonly version?: string;
  readonly description?: string;
  readonly apiPrefix?: string;
  readonly serverUrl?: string;
}

export interface PostmanItem {
  readonly name: string;
  readonly request: {
    readonly method: string;
    readonly header: ReadonlyArray<{ readonly key: string; readonly value: string }>;
    readonly url: {
      readonly raw: string;
      readonly host: readonly string[];
      readonly path: readonly string[];
      readonly query?: ReadonlyArray<{
        readonly key: string;
        readonly value: string;
        readonly description?: string;
      }>;
    };
    readonly body?: {
      readonly mode: 'raw';
      readonly raw: string;
      readonly options: { readonly raw: { readonly language: 'json' } };
    };
    readonly description?: string;
  };
}

export interface PostmanFolder {
  readonly name: string;
  readonly description?: string;
  readonly item: readonly PostmanItem[];
}

export interface PostmanCollection {
  readonly info: {
    readonly name: string;
    readonly description: string;
    readonly schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
  };
  readonly variable: ReadonlyArray<{ readonly key: string; readonly value: string }>;
  readonly item: readonly PostmanFolder[];
}

export const BREAKING_CHANGE_RULES = {
  ENDPOINT_REMOVED: 'ENDPOINT_REMOVED',
  REQUIRED_PARAM_ADDED: 'REQUIRED_PARAM_ADDED',
  PARAM_TYPE_OR_ENUM_NARROWED: 'PARAM_TYPE_OR_ENUM_NARROWED',
  REQUIRED_BODY_FIELD_ADDED: 'REQUIRED_BODY_FIELD_ADDED',
  BODY_FIELD_REMOVED_OR_TYPE_CHANGED: 'BODY_FIELD_REMOVED_OR_TYPE_CHANGED',
  RESPONSE_FIELD_REMOVED_OR_TYPE_CHANGED: 'RESPONSE_FIELD_REMOVED_OR_TYPE_CHANGED',
  SECURITY_TIGHTENED: 'SECURITY_TIGHTENED',
} as const;

export type BreakingChangeRule = (typeof BREAKING_CHANGE_RULES)[keyof typeof BREAKING_CHANGE_RULES];

export interface BreakingChangeIssue {
  readonly rule: BreakingChangeRule;
  readonly severity: 'BREAKING';
  readonly path: string;
  readonly method: string;
  readonly field?: string;
  readonly message: string;
}

export interface BreakingChangeReport {
  readonly passed: boolean;
  readonly totalOperationsCompared: number;
  readonly breakingChanges: readonly BreakingChangeIssue[];
}

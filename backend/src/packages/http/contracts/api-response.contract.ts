import type {
  CursorPaginationMeta,
  PaginationMeta,
  ValidationSource,
} from '@packages/kernel/index.js';

export interface ApiSuccessResponse<T, TMeta = Record<string, unknown>> {
  readonly success: true;
  readonly statusCode: number;
  readonly data: T;
  readonly meta?: TMeta;
  readonly timestamp: string;
}

export type ApiPaginatedResponse<T> = ApiSuccessResponse<readonly T[], PaginationMeta>;

export type ApiCursorPaginatedResponse<T> = ApiSuccessResponse<readonly T[], CursorPaginationMeta>;

export interface ApiErrorDetail {
  readonly field?: string;
  readonly message: string;
  readonly code?: string;
  readonly source?: ValidationSource;
}

export interface ApiErrorEnvelope {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown[];
}

export interface ApiErrorResponse {
  readonly success: false;
  readonly statusCode: number;
  readonly error: ApiErrorEnvelope;
  readonly timestamp: string;
}

export type ApiResponse<T, TMeta = Record<string, unknown>> =
  ApiSuccessResponse<T, TMeta> | ApiErrorResponse;

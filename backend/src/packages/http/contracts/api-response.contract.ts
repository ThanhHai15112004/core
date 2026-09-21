export interface ApiSuccessResponse<T> {
  readonly success: true;
  readonly statusCode: number;
  readonly data: T;
  readonly meta?: Record<string, unknown>;
  readonly timestamp: string;
}

export interface ApiErrorDetail {
  readonly field?: string;
  readonly message: string;
  readonly code?: string;
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

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

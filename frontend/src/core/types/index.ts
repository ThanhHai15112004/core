export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string;
}

/** Envelope thành công do `TransformResponseInterceptor` của backend bọc. */
export interface ApiResponse<T> {
  success: true;
  statusCode: number;
  data: T;
  meta?: Record<string, unknown>;
  timestamp: string;
}

/** Envelope lỗi do `GlobalExceptionFilter` của backend trả về. */
export interface ApiErrorResponse {
  success: false;
  statusCode: number;
  error: { code: string; message: string; details?: unknown[] };
  timestamp: string;
}

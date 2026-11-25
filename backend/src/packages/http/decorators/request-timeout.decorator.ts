import { SetMetadata } from '@nestjs/common';

export const REQUEST_TIMEOUT_METADATA_KEY = 'core:http:request_timeout_ms';

/**
 * Thiết lập thời gian chờ tối đa (ms) cho riêng một controller hoặc endpoint API.
 * Quá ngưỡng này, `RequestTimeoutInterceptor` trả về `504 Gateway Timeout` theo Envelope chuẩn.
 */
export const RequestTimeout = (timeoutMs: number): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUEST_TIMEOUT_METADATA_KEY, Math.max(0, Math.floor(timeoutMs)));

/**
 * Tắt giới hạn timeout tầng interceptor cho các endpoint đặc thù (tải xuống luồng, SSE, upload dung lượng lớn).
 */
export const NoRequestTimeout = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUEST_TIMEOUT_METADATA_KEY, 0);

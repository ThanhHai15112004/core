import { SetMetadata } from '@nestjs/common';

export const LOG_REQUEST_BODY_METADATA = Symbol('LOG_REQUEST_BODY_ALLOWLIST');

/**
 * Khai báo danh sách các field được phép ghi vào HTTP log (`reqBody`) cho controller hoặc route cụ thể.
 * Dữ liệu luôn được lọc theo allowlist, cắt theo `LOG_REQUEST_BODY_MAX_BYTES` và che khóa nhạy cảm trước khi ghi.
 */
export const LogRequestBody = (
  allowedFields: readonly string[],
): MethodDecorator & ClassDecorator => SetMetadata(LOG_REQUEST_BODY_METADATA, allowedFields);

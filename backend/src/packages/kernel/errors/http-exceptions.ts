import { AppException, type MessageParams } from './app.exception.js';

/**
 * Bảng hằng số HTTP Status Code chuẩn của hệ thống (tầng Kernel không phụ thuộc NestJS).
 */
export const HTTP_STATUS_CODE = {
  OK: 200,
  CREATED: 201,
  ACCEPTED: 202,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type HttpStatusCodeValue = (typeof HTTP_STATUS_CODE)[keyof typeof HTTP_STATUS_CODE];

/**
 * Bảng hằng số mã lỗi (Error Code) chuẩn dùng chung toàn hệ thống.
 * Các mã này khớp với khóa dịch trong `packages/i18n/locales/<locale>/common.json`.
 */
export const HTTP_ERROR_CODE = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  DOMAIN_ERROR: 'DOMAIN_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNPROCESSABLE_ENTITY: 'UNPROCESSABLE_ENTITY',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  HTTP_ERROR: 'HTTP_ERROR',
} as const;

export type HttpErrorCodeValue = (typeof HTTP_ERROR_CODE)[keyof typeof HTTP_ERROR_CODE];

/** Lỗi 400 Bad Request — Yêu cầu từ phía client không hợp lệ. */
export class BadRequestAppException extends AppException {
  public override readonly code: string;

  /** Khởi tạo ngoại lệ 400 Bad Request với thông điệp và chi tiết lỗi tùy chọn */
  constructor(
    message: string = HTTP_ERROR_CODE.BAD_REQUEST,
    details: unknown[] = [],
    messageParams?: MessageParams,
    code: string = HTTP_ERROR_CODE.BAD_REQUEST,
  ) {
    super(message, HTTP_STATUS_CODE.BAD_REQUEST, details, messageParams);
    this.code = code;
  }
}

/** Lỗi 400 Validation Failed — Dữ liệu đầu vào (Body/Query/Params) không vượt qua kiểm tra hợp lệ. */
export class ValidationAppException extends AppException {
  public override readonly code: string;

  /** Khởi tạo ngoại lệ 400 Validation Failed kèm danh sách chi tiết trường dữ liệu không hợp lệ */
  constructor(
    details: unknown[] = [],
    message: string = HTTP_ERROR_CODE.VALIDATION_FAILED,
    messageParams?: MessageParams,
    code: string = HTTP_ERROR_CODE.VALIDATION_FAILED,
  ) {
    super(message, HTTP_STATUS_CODE.BAD_REQUEST, details, messageParams);
    this.code = code;
  }
}

/** Lỗi 401 Unauthorized — Chưa xác thực hoặc phiên đăng nhập không hợp lệ. */
export class UnauthorizedAppException extends AppException {
  public override readonly code: string;

  /** Khởi tạo ngoại lệ 401 Unauthorized khi thiếu thông tin xác thực hợp lệ */
  constructor(
    message: string = HTTP_ERROR_CODE.UNAUTHORIZED,
    details: unknown[] = [],
    messageParams?: MessageParams,
    code: string = HTTP_ERROR_CODE.UNAUTHORIZED,
  ) {
    super(message, HTTP_STATUS_CODE.UNAUTHORIZED, details, messageParams);
    this.code = code;
  }
}

/** Lỗi 403 Forbidden — Đã xác thực nhưng không đủ quyền truy cập tài nguyên. */
export class ForbiddenAppException extends AppException {
  public override readonly code: string;

  /** Khởi tạo ngoại lệ 403 Forbidden khi người dùng không có quyền thực hiện thao tác */
  constructor(
    message: string = HTTP_ERROR_CODE.FORBIDDEN,
    details: unknown[] = [],
    messageParams?: MessageParams,
    code: string = HTTP_ERROR_CODE.FORBIDDEN,
  ) {
    super(message, HTTP_STATUS_CODE.FORBIDDEN, details, messageParams);
    this.code = code;
  }
}

/** Lỗi 409 Conflict — Xung đột trạng thái dữ liệu hoặc bản ghi đã tồn tại. */
export class ConflictAppException extends AppException {
  public override readonly code: string;

  /** Khởi tạo ngoại lệ 409 Conflict khi dữ liệu bị trùng lặp hoặc xung đột trạng thái */
  constructor(
    message: string = HTTP_ERROR_CODE.CONFLICT,
    details: unknown[] = [],
    messageParams?: MessageParams,
    code: string = HTTP_ERROR_CODE.CONFLICT,
  ) {
    super(message, HTTP_STATUS_CODE.CONFLICT, details, messageParams);
    this.code = code;
  }
}

/** Lỗi 422 Unprocessable Entity — Cú pháp đúng nhưng không thể xử lý ngữ nghĩa nghiệp vụ. */
export class UnprocessableEntityAppException extends AppException {
  public override readonly code: string;

  /** Khởi tạo ngoại lệ 422 Unprocessable Entity khi dữ liệu không thỏa mãn ngữ nghĩa xử lý */
  constructor(
    message: string = HTTP_ERROR_CODE.UNPROCESSABLE_ENTITY,
    details: unknown[] = [],
    messageParams?: MessageParams,
    code: string = HTTP_ERROR_CODE.UNPROCESSABLE_ENTITY,
  ) {
    super(message, HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY, details, messageParams);
    this.code = code;
  }
}

/** Lỗi 429 Too Many Requests — Vượt quá giới hạn tần suất gọi API (Rate Limit). */
export class TooManyRequestsAppException extends AppException {
  public override readonly code: string;

  /** Khởi tạo ngoại lệ 429 Too Many Requests khi vượt ngưỡng giới hạn tần suất yêu cầu */
  constructor(
    message: string = HTTP_ERROR_CODE.TOO_MANY_REQUESTS,
    details: unknown[] = [],
    messageParams?: MessageParams,
    code: string = HTTP_ERROR_CODE.TOO_MANY_REQUESTS,
  ) {
    super(message, HTTP_STATUS_CODE.TOO_MANY_REQUESTS, details, messageParams);
    this.code = code;
  }
}

/** Lỗi 500 Internal Server Error — Lỗi hệ thống nội bộ. */
export class InternalServerAppException extends AppException {
  public override readonly code: string;

  /** Khởi tạo ngoại lệ 500 Internal Server Error cho các lỗi phát sinh nội bộ hệ thống */
  constructor(
    message: string = HTTP_ERROR_CODE.INTERNAL_SERVER_ERROR,
    details: unknown[] = [],
    messageParams?: MessageParams,
    code: string = HTTP_ERROR_CODE.INTERNAL_SERVER_ERROR,
  ) {
    super(message, HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR, details, messageParams);
    this.code = code;
  }
}

/** Lỗi 503 Service Unavailable — Dịch vụ hoặc thành phần hạ tầng tạm thời không khả dụng. */
export class ServiceUnavailableAppException extends AppException {
  public override readonly code: string;

  /** Khởi tạo ngoại lệ 503 Service Unavailable khi dịch vụ hoặc tài nguyên hạ tầng gián đoạn */
  constructor(
    message: string = HTTP_ERROR_CODE.SERVICE_UNAVAILABLE,
    details: unknown[] = [],
    messageParams?: MessageParams,
    code: string = HTTP_ERROR_CODE.SERVICE_UNAVAILABLE,
  ) {
    super(message, HTTP_STATUS_CODE.SERVICE_UNAVAILABLE, details, messageParams);
    this.code = code;
  }
}

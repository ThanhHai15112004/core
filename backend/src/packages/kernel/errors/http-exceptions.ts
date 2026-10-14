import {
  AppException,
  ERROR_CATEGORY,
  type ErrorCategory,
  type MessageParams,
} from './app.exception.js';

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
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type HttpStatusCodeValue = (typeof HTTP_STATUS_CODE)[keyof typeof HTTP_STATUS_CODE];

/**
 * Nguồn dữ liệu đầu vào của HTTP request phục vụ kiểm tra hợp lệ (Validation).
 */
export const VALIDATION_SOURCE = {
  BODY: 'body',
  QUERY: 'query',
  PARAMS: 'params',
} as const;

export type ValidationSource = (typeof VALIDATION_SOURCE)[keyof typeof VALIDATION_SOURCE];

/**
 * Bảng hằng số mã lỗi (Error Code) chuẩn dùng chung toàn hệ thống.
 * Các mã này khớp với khóa dịch trong `packages/i18n/locales/<locale>/common.json`.
 */
export const HTTP_ERROR_CODE = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  INVALID_REQUEST_BODY: 'INVALID_REQUEST_BODY',
  INVALID_QUERY_PARAMS: 'INVALID_QUERY_PARAMS',
  INVALID_PATH_PARAMS: 'INVALID_PATH_PARAMS',
  UNRECOGNIZED_FIELDS: 'UNRECOGNIZED_FIELDS',
  INVALID_JSON_PAYLOAD: 'INVALID_JSON_PAYLOAD',
  DOMAIN_ERROR: 'DOMAIN_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  DUPLICATE_RESOURCE: 'DUPLICATE_RESOURCE',
  OPTIMISTIC_LOCK_VERSION_MISMATCH: 'OPTIMISTIC_LOCK_VERSION_MISMATCH',
  ORM_ENTITY_LEAK_DETECTED: 'ORM_ENTITY_LEAK_DETECTED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  UNPROCESSABLE_ENTITY: 'UNPROCESSABLE_ENTITY',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  HTTP_ERROR: 'HTTP_ERROR',
} as const;

export type HttpErrorCodeValue = (typeof HTTP_ERROR_CODE)[keyof typeof HTTP_ERROR_CODE];

/**
 * Danh sách mã lỗi chuyên biệt cho tầng Validation dữ liệu đầu vào.
 */
export const VALIDATION_ERROR_CODE = {
  VALIDATION_FAILED: HTTP_ERROR_CODE.VALIDATION_FAILED,
  INVALID_REQUEST_BODY: HTTP_ERROR_CODE.INVALID_REQUEST_BODY,
  INVALID_QUERY_PARAMS: HTTP_ERROR_CODE.INVALID_QUERY_PARAMS,
  INVALID_PATH_PARAMS: HTTP_ERROR_CODE.INVALID_PATH_PARAMS,
  UNRECOGNIZED_FIELDS: HTTP_ERROR_CODE.UNRECOGNIZED_FIELDS,
  INVALID_JSON_PAYLOAD: HTTP_ERROR_CODE.INVALID_JSON_PAYLOAD,
} as const;

export type ValidationErrorCodeValue =
  (typeof VALIDATION_ERROR_CODE)[keyof typeof VALIDATION_ERROR_CODE];

/**
 * Danh sách mã lỗi chi tiết trên từng trường dữ liệu (`ApiErrorDetail.code`).
 */
export const VALIDATION_ISSUE_CODE = {
  REQUIRED: 'required',
  INVALID_TYPE: 'invalid_type',
  INVALID_FORMAT: 'invalid_format',
  TOO_SMALL: 'too_small',
  TOO_BIG: 'too_big',
  INVALID_VALUE: 'invalid_value',
  UNRECOGNIZED_KEYS: 'unrecognized_keys',
  CUSTOM: 'custom',
} as const;

export type ValidationIssueCodeValue =
  (typeof VALIDATION_ISSUE_CODE)[keyof typeof VALIDATION_ISSUE_CODE];

/**
 * Bảng mã lỗi dùng chung toàn hệ thống (alias tường minh của `HTTP_ERROR_CODE`).
 */
export const COMMON_ERROR_CODE = HTTP_ERROR_CODE;

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
    super(
      message,
      HTTP_STATUS_CODE.BAD_REQUEST,
      details,
      messageParams,
      ERROR_CATEGORY.CLIENT,
      true,
    );
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
    super(
      message,
      HTTP_STATUS_CODE.BAD_REQUEST,
      details,
      messageParams,
      ERROR_CATEGORY.CLIENT,
      true,
    );
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
    super(
      message,
      HTTP_STATUS_CODE.UNAUTHORIZED,
      details,
      messageParams,
      ERROR_CATEGORY.CLIENT,
      true,
    );
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
    super(message, HTTP_STATUS_CODE.FORBIDDEN, details, messageParams, ERROR_CATEGORY.CLIENT, true);
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
    super(message, HTTP_STATUS_CODE.CONFLICT, details, messageParams, ERROR_CATEGORY.CLIENT, true);
    this.code = code;
  }
}

/** Lỗi 413 Payload Too Large — Kích thước dữ liệu gửi lên vượt quá giới hạn cho phép. */
export class PayloadTooLargeAppException extends AppException {
  public override readonly code: string;

  /** Khởi tạo ngoại lệ 413 Payload Too Large khi dung lượng request vượt ngưỡng */
  constructor(
    message: string = HTTP_ERROR_CODE.PAYLOAD_TOO_LARGE,
    details: unknown[] = [],
    messageParams?: MessageParams,
    code: string = HTTP_ERROR_CODE.PAYLOAD_TOO_LARGE,
  ) {
    super(
      message,
      HTTP_STATUS_CODE.PAYLOAD_TOO_LARGE,
      details,
      messageParams,
      ERROR_CATEGORY.CLIENT,
      true,
    );
    this.code = code;
  }
}

/** Lỗi 415 Unsupported Media Type — Định dạng Content-Type gửi lên không được hỗ trợ. */
export class UnsupportedMediaTypeAppException extends AppException {
  public override readonly code: string;

  /** Khởi tạo ngoại lệ 415 Unsupported Media Type khi Content-Type không hợp lệ */
  constructor(
    message: string = HTTP_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE,
    details: unknown[] = [],
    messageParams?: MessageParams,
    code: string = HTTP_ERROR_CODE.UNSUPPORTED_MEDIA_TYPE,
  ) {
    super(
      message,
      HTTP_STATUS_CODE.UNSUPPORTED_MEDIA_TYPE,
      details,
      messageParams,
      ERROR_CATEGORY.CLIENT,
      true,
    );
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
    super(
      message,
      HTTP_STATUS_CODE.UNPROCESSABLE_ENTITY,
      details,
      messageParams,
      ERROR_CATEGORY.CLIENT,
      true,
    );
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
    super(
      message,
      HTTP_STATUS_CODE.TOO_MANY_REQUESTS,
      details,
      messageParams,
      ERROR_CATEGORY.CLIENT,
      true,
    );
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
    super(
      message,
      HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR,
      details,
      messageParams,
      ERROR_CATEGORY.SYSTEM,
      false,
    );
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
    super(
      message,
      HTTP_STATUS_CODE.SERVICE_UNAVAILABLE,
      details,
      messageParams,
      ERROR_CATEGORY.SYSTEM,
      false,
    );
    this.code = code;
  }
}

export interface ErrorClassification {
  readonly category: ErrorCategory;
  readonly isOperational: boolean;
  readonly isUserError: boolean;
  readonly isSystemError: boolean;
  readonly statusCode: number;
}

/**
 * Phân tích và phân loại một ngoại lệ bất kỳ thành lỗi người dùng (`CLIENT` / `DOMAIN`, 4xx)
 * hoặc lỗi hệ thống (`SYSTEM`, 5xx).
 */
export function classifyError(exception: unknown): ErrorClassification {
  if (exception instanceof AppException) {
    const isSystem =
      exception.category === ERROR_CATEGORY.SYSTEM ||
      !exception.isOperational ||
      exception.statusCode >= HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR;
    return {
      category: exception.category,
      isOperational: exception.isOperational,
      isUserError: !isSystem,
      isSystemError: isSystem,
      statusCode: exception.statusCode,
    };
  }

  if (typeof exception === 'object' && exception !== null) {
    const errRecord = exception as Record<string, unknown>;

    // ZodError (kiểm tra duck-typing theo name & issues để không phụ thuộc cứng vào instance)
    if (errRecord['name'] === 'ZodError' && Array.isArray(errRecord['issues'])) {
      return {
        category: ERROR_CATEGORY.CLIENT,
        isOperational: true,
        isUserError: true,
        isSystemError: false,
        statusCode: HTTP_STATUS_CODE.BAD_REQUEST,
      };
    }

    // NestJS HttpException hoặc FastifyError có statusCode / getStatus()
    const rawStatus =
      typeof errRecord['getStatus'] === 'function'
        ? (errRecord['getStatus'] as () => number)()
        : typeof errRecord['statusCode'] === 'number'
          ? errRecord['statusCode']
          : undefined;

    if (typeof rawStatus === 'number' && rawStatus >= 400 && rawStatus < 600) {
      const isSystem = rawStatus >= HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR;
      return {
        category: isSystem ? ERROR_CATEGORY.SYSTEM : ERROR_CATEGORY.CLIENT,
        isOperational: !isSystem,
        isUserError: !isSystem,
        isSystemError: isSystem,
        statusCode: rawStatus,
      };
    }
  }

  return {
    category: ERROR_CATEGORY.SYSTEM,
    isOperational: false,
    isUserError: false,
    isSystemError: true,
    statusCode: HTTP_STATUS_CODE.INTERNAL_SERVER_ERROR,
  };
}

/**
 * Kiểm tra nhanh ngoại lệ có phải là lỗi từ phía người dùng / nghiệp vụ (4xx, operational) hay không.
 */
export function isUserError(exception: unknown): boolean {
  return classifyError(exception).isUserError;
}

/**
 * Kiểm tra nhanh ngoại lệ có phải là lỗi hệ thống nội bộ (5xx, non-operational) hay không.
 */
export function isSystemError(exception: unknown): boolean {
  return classifyError(exception).isSystemError;
}

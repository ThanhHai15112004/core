export type MessageParams = Record<string, string | number>;

/**
 * Phân nhóm ngoại lệ chuẩn hóa toàn hệ thống:
 * - `CLIENT`: Lỗi từ phía người dùng / client gửi request không hợp lệ (4xx: validation, auth, not found, conflict, rate-limit...).
 * - `DOMAIN`: Lỗi vi phạm quy tắc nghiệp vụ (4xx: domain rule violation).
 * - `SYSTEM`: Lỗi hệ thống nội bộ hoặc hạ tầng (5xx: database crash, unhandled exception, service unavailable...).
 */
export const ERROR_CATEGORY = {
  CLIENT: 'CLIENT',
  DOMAIN: 'DOMAIN',
  SYSTEM: 'SYSTEM',
} as const;

export type ErrorCategory = (typeof ERROR_CATEGORY)[keyof typeof ERROR_CATEGORY];

/**
 * `message` có thể là text thường hoặc một i18n key (vd. `ops.package.notFound`);
 * `GlobalExceptionFilter` sẽ dịch theo locale của request, dùng `messageParams` để nội suy.
 */
export abstract class AppException extends Error {
  public abstract readonly code: string;
  public readonly statusCode: number;
  public readonly details: unknown[];
  public readonly messageParams: MessageParams | undefined;
  public readonly category: ErrorCategory;
  public readonly isOperational: boolean;

  /** Khởi tạo ngoại lệ ứng dụng cơ sở với thông điệp, mã trạng thái HTTP, chi tiết lỗi và tham số dịch */
  constructor(
    message: string,
    statusCode = 500,
    details: unknown[] = [],
    messageParams?: MessageParams,
    category?: ErrorCategory,
    isOperational?: boolean,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.details = details;
    this.messageParams = messageParams;
    const isServerFault = statusCode >= 500;
    this.category = category ?? (isServerFault ? ERROR_CATEGORY.SYSTEM : ERROR_CATEGORY.CLIENT);
    this.isOperational = isOperational ?? !isServerFault;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

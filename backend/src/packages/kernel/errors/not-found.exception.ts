import { AppException, ERROR_CATEGORY, type MessageParams } from './app.exception.js';
import { HTTP_ERROR_CODE, HTTP_STATUS_CODE } from './http-exceptions.js';

/** Ngoại lệ không tìm thấy tài nguyên yêu cầu (404 Not Found). */
export class NotFoundAppException extends AppException {
  public override readonly code: string;

  /** Khởi tạo ngoại lệ 404 Not Found với khóa dịch và tham số nội suy tùy chọn */
  constructor(
    message: string = HTTP_ERROR_CODE.NOT_FOUND,
    messageParams?: MessageParams,
    details: unknown[] = [],
    code: string = HTTP_ERROR_CODE.NOT_FOUND,
  ) {
    super(message, HTTP_STATUS_CODE.NOT_FOUND, details, messageParams, ERROR_CATEGORY.CLIENT, true);
    this.code = code;
  }
}

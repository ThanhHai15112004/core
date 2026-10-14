import { AppException } from './app.exception.js';
import { HTTP_ERROR_CODE, HTTP_STATUS_CODE } from './http-exceptions.js';

/** Ngoại lệ vi phạm quy tắc nghiệp vụ (400 Domain Error). */
export class DomainException extends AppException {
  public override readonly code: string;

  /** Khởi tạo ngoại lệ nghiệp vụ với thông điệp, mã lỗi và chi tiết bổ sung */
  constructor(
    message: string,
    code: string = HTTP_ERROR_CODE.DOMAIN_ERROR,
    details: unknown[] = [],
  ) {
    super(message, HTTP_STATUS_CODE.BAD_REQUEST, details);
    this.code = code;
  }
}

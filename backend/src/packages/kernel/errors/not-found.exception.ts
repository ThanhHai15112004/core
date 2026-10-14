import { AppException, type MessageParams } from './app.exception.js';
import { HTTP_ERROR_CODE, HTTP_STATUS_CODE } from './http-exceptions.js';

/** Ngoại lệ không tìm thấy tài nguyên yêu cầu (404 Not Found). */
export class NotFoundAppException extends AppException {
  public override readonly code = HTTP_ERROR_CODE.NOT_FOUND;

  /** Khởi tạo ngoại lệ 404 Not Found với khóa dịch và tham số nội suy tùy chọn */
  constructor(message: string = HTTP_ERROR_CODE.NOT_FOUND, messageParams?: MessageParams) {
    super(message, HTTP_STATUS_CODE.NOT_FOUND, [], messageParams);
  }
}

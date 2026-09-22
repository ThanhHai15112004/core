import { AppException, type MessageParams } from '@packages/kernel/index.js';

export class DatabaseValidationException extends AppException {
  public override readonly code = 'VALIDATION_FAILED';

  constructor(details: unknown[] = []) {
    super('VALIDATION_FAILED', 400, details);
  }
}

/** Database chưa kết nối được — phần số liệu cần truy vấn trực tiếp không có. */
export class DatabaseNotConnectedException extends AppException {
  public override readonly code = 'DATABASE_NOT_CONNECTED';

  constructor(state: string) {
    super('database.error.notConnected', 503, [], { state });
  }
}

export class DatabaseNotFoundException extends AppException {
  public override readonly code = 'DATABASE_RESOURCE_NOT_FOUND';

  constructor(messageKey: string, params: MessageParams) {
    super(messageKey, 404, [], params);
  }
}

/** Thao tác bị từ chối (đã tắt, không hỗ trợ, session không hợp lệ…). Message là i18n key. */
export class DatabaseActionRejectedException extends AppException {
  public override readonly code: string;

  constructor(code: string, messageKey: string, params?: MessageParams, status = 409) {
    super(messageKey, status, [], params);
    this.code = `DATABASE_${code}`;
  }
}

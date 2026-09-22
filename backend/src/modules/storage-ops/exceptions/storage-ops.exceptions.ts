import { AppException, type MessageParams } from '@packages/kernel/index.js';

export class StorageValidationException extends AppException {
  public override readonly code = 'VALIDATION_FAILED';

  constructor(details: unknown[] = []) {
    super('VALIDATION_FAILED', 400, details);
  }
}

/** Storage chưa kết nối được — phần cần đọc trực tiếp không có. */
export class StorageNotConnectedException extends AppException {
  public override readonly code = 'STORAGE_NOT_CONNECTED';

  constructor(state: string) {
    super('storage.error.notConnected', 503, [], { state });
  }
}

export class StorageNotFoundException extends AppException {
  public override readonly code = 'STORAGE_RESOURCE_NOT_FOUND';

  constructor(messageKey: string, params: MessageParams) {
    super(messageKey, 404, [], params);
  }
}

/** Thao tác bị từ chối (đã tắt, không hỗ trợ, đang bận…). Message là i18n key. */
export class StorageActionRejectedException extends AppException {
  public override readonly code: string;

  constructor(code: string, messageKey: string, params?: MessageParams, status = 409) {
    super(messageKey, status, [], params);
    this.code = `STORAGE_${code}`;
  }
}

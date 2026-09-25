import { AppException, type MessageParams } from '@packages/kernel/index.js';

export class MessagingValidationException extends AppException {
  public override readonly code = 'VALIDATION_FAILED';

  constructor(details: unknown[] = []) {
    super('VALIDATION_FAILED', 400, details);
  }
}

/** Broker chưa kết nối được — phần cần đọc trực tiếp không có. */
export class MessagingNotConnectedException extends AppException {
  public override readonly code = 'MESSAGING_NOT_CONNECTED';

  constructor(state: string) {
    super('messaging.error.notConnected', 503, [], { state });
  }
}

export class MessagingNotFoundException extends AppException {
  public override readonly code = 'MESSAGING_RESOURCE_NOT_FOUND';

  constructor(messageKey: string, params: MessageParams) {
    super(messageKey, 404, [], params);
  }
}

/** Thao tác bị từ chối (đã tắt, không hỗ trợ, sai trạng thái…). Message là i18n key. */
export class MessagingActionRejectedException extends AppException {
  public override readonly code: string;

  constructor(code: string, messageKey: string, params?: MessageParams, status = 409) {
    super(messageKey, status, [], params);
    this.code = `MESSAGING_${code}`;
  }
}

import { AppException, type MessageParams } from '@packages/kernel/index.js';

export class WorkerValidationException extends AppException {
  public override readonly code = 'VALIDATION_FAILED';

  constructor(details: unknown[] = []) {
    super('VALIDATION_FAILED', 400, details);
  }
}

/** Broker queue chưa kết nối được — phần cần đọc trực tiếp không có. */
export class QueueNotConnectedException extends AppException {
  public override readonly code = 'QUEUE_NOT_CONNECTED';

  constructor(state: string) {
    super('worker.error.notConnected', 503, [], { state });
  }
}

export class WorkerNotFoundException extends AppException {
  public override readonly code = 'WORKER_RESOURCE_NOT_FOUND';

  constructor(messageKey: string, params: MessageParams) {
    super(messageKey, 404, [], params);
  }
}

/** Thao tác queue bị từ chối (đã tắt, không hỗ trợ, sai trạng thái…). Message là i18n key. */
export class QueueActionRejectedException extends AppException {
  public override readonly code: string;

  constructor(code: string, messageKey: string, params?: MessageParams, status = 409) {
    super(messageKey, status, [], params);
    this.code = `QUEUE_${code}`;
  }
}

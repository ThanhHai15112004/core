import { AppException, type MessageParams } from '@packages/kernel/index.js';

export class CacheValidationException extends AppException {
  public override readonly code = 'VALIDATION_FAILED';

  constructor(details: unknown[] = []) {
    super('VALIDATION_FAILED', 400, details);
  }
}

/** Backend cache chưa kết nối được — phần cần đọc trực tiếp không có. */
export class CacheNotConnectedException extends AppException {
  public override readonly code = 'CACHE_NOT_CONNECTED';

  constructor(state: string) {
    super('cache.error.notConnected', 503, [], { state });
  }
}

export class CacheNotFoundException extends AppException {
  public override readonly code = 'CACHE_RESOURCE_NOT_FOUND';

  constructor(messageKey: string, params: MessageParams) {
    super(messageKey, 404, [], params);
  }
}

/** Thao tác bị từ chối (đã tắt, không hỗ trợ, đang bận…). Message là i18n key. */
export class CacheActionRejectedException extends AppException {
  public override readonly code: string;

  constructor(code: string, messageKey: string, params?: MessageParams, status = 409) {
    super(messageKey, status, [], params);
    this.code = `CACHE_${code}`;
  }
}

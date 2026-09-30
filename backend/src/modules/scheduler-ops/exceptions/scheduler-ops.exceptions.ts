import { AppException, type MessageParams } from '@packages/kernel/index.js';

export class SchedulerValidationException extends AppException {
  public override readonly code = 'VALIDATION_FAILED';

  constructor(details: unknown[] = []) {
    super('VALIDATION_FAILED', 400, details);
  }
}

export class SchedulerNotFoundException extends AppException {
  public override readonly code = 'SCHEDULER_RESOURCE_NOT_FOUND';

  constructor(messageKey: string, params: MessageParams) {
    super(messageKey, 404, [], params);
  }
}

/** Không đọc/ghi được dữ liệu Scheduler (Redis chưa kết nối) hoặc không có scheduler instance nào đang chạy. */
export class SchedulerUnavailableException extends AppException {
  public override readonly code: string;

  constructor(code: 'STORE_UNAVAILABLE' | 'RUNTIME_DOWN' | 'NO_RESPONSE', params?: MessageParams) {
    super(`scheduler.error.${code}`, code === 'NO_RESPONSE' ? 504 : 503, [], params);
    this.code = `SCHEDULER_${code}`;
  }
}

/** Thao tác bị từ chối (đã tắt bằng env, task đang chạy, sai trạng thái…). Message là i18n key. */
export class SchedulerActionRejectedException extends AppException {
  public override readonly code: string;

  constructor(code: string, params?: MessageParams, status = 409) {
    super(`scheduler.error.${code}`, status, [], params);
    this.code = `SCHEDULER_${code}`;
  }
}

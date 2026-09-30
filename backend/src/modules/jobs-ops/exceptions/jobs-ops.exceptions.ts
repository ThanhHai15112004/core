import { AppException, type MessageParams } from '@packages/kernel/index.js';

export class JobsValidationException extends AppException {
  public override readonly code = 'VALIDATION_FAILED';

  constructor(details: unknown[] = []) {
    super('VALIDATION_FAILED', 400, details);
  }
}

export class JobNotFoundException extends AppException {
  public override readonly code = 'JOB_NOT_FOUND';

  constructor(params: MessageParams) {
    super('jobs.error.NOT_FOUND', 404, [], params);
  }
}

/** Queue provider không kết nối — không đọc/thao tác được job. */
export class JobsUnavailableException extends AppException {
  public override readonly code = 'JOBS_UNAVAILABLE';

  constructor(params?: MessageParams) {
    super('jobs.error.UNAVAILABLE', 503, [], params);
  }
}

/** Thao tác bị từ chối (tắt bằng env, sai trạng thái, lỗi không retry được, không hỗ trợ huỷ…). */
export class JobActionRejectedException extends AppException {
  public override readonly code: string;

  constructor(code: string, messageKey: string, params?: MessageParams, status = 409) {
    super(messageKey, status, [], params);
    this.code = `JOBS_${code}`;
  }
}

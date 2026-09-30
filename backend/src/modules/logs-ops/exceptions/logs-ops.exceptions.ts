import { AppException, type MessageParams } from '@packages/kernel/index.js';

export class LogsValidationException extends AppException {
  public override readonly code = 'VALIDATION_FAILED';

  constructor(details: unknown[] = []) {
    super('VALIDATION_FAILED', 400, details);
  }
}

export class LogNotFoundException extends AppException {
  public override readonly code: string;

  constructor(
    code: 'LOG_NOT_FOUND' | 'ERROR_GROUP_NOT_FOUND' | 'TRACE_NOT_FOUND',
    params: MessageParams,
  ) {
    super(`logs.error.${code}`, 404, [], params);
    this.code = code;
  }
}

/** Kho log (Redis) không kết nối — không truy vấn được log; các màn khác của Console vẫn chạy. */
export class LogsUnavailableException extends AppException {
  public override readonly code = 'LOGS_UNAVAILABLE';

  constructor() {
    super('logs.error.UNAVAILABLE', 503);
  }
}

/** Thao tác bị từ chối (tắt bằng env, runtime không chạy, thời hạn không cho phép…). */
export class LogsActionRejectedException extends AppException {
  public override readonly code: string;

  constructor(code: string, params?: MessageParams, status = 409) {
    super(`logs.error.${code}`, status, [], params);
    this.code = `LOGS_${code}`;
  }
}

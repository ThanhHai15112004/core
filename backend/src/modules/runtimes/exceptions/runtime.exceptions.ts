import { AppException, type MessageParams } from '@packages/kernel/index.js';

/** Action bị từ chối vì trạng thái/cấu hình hiện tại (message là i18n key). */
export class RuntimeActionNotAllowedException extends AppException {
  public override readonly code = 'RUNTIME_ACTION_NOT_ALLOWED';

  constructor(messageKey: string, params?: MessageParams) {
    super(messageKey, 409, [], params);
  }
}

export class RuntimeValidationException extends AppException {
  public override readonly code = 'VALIDATION_FAILED';

  constructor(messageKey: string, details: unknown[] = []) {
    super(messageKey, 400, details);
  }
}

/** Không đọc/ghi được Redis nên không có telemetry. */
export class RuntimeTelemetryUnavailableException extends AppException {
  public override readonly code = 'RUNTIME_TELEMETRY_UNAVAILABLE';

  constructor() {
    super('runtime.error.telemetryUnavailable', 503);
  }
}

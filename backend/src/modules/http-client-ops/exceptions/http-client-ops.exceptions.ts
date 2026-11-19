import { AppException, type MessageParams } from '@packages/kernel/index.js';

export class HttpClientOpsValidationException extends AppException {
  public override readonly code = 'VALIDATION_FAILED';

  constructor(details: unknown[] = []) {
    super('VALIDATION_FAILED', 400, details);
  }
}

export class HttpClientServiceNotFoundException extends AppException {
  public override readonly code = 'HTTP_CLIENT_SERVICE_NOT_FOUND';

  constructor(service: string, params?: MessageParams) {
    super('ops.httpClient.error.serviceNotFound', 404, [], params ?? { service });
  }
}

export class HttpClientActionRejectedException extends AppException {
  public override readonly code = 'HTTP_CLIENT_RESET_DISABLED';

  constructor() {
    super('ops.httpClient.error.resetDisabled', 409, []);
  }
}

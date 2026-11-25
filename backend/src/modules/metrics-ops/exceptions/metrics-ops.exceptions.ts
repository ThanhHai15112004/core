import { AppException, type MessageParams } from '@packages/kernel/index.js';

export class MetricsOpsValidationException extends AppException {
  public override readonly code = 'VALIDATION_FAILED';

  constructor(details: unknown[] = []) {
    super('VALIDATION_FAILED', 400, details);
  }
}

export class AlertRuleNotFoundException extends AppException {
  public override readonly code = 'ALERT_RULE_NOT_FOUND';

  constructor(id: number, params?: MessageParams) {
    super('metricsOps.error.ruleNotFound', 404, [], params ?? { id });
  }
}

export class AlertRuleCodeDuplicateException extends AppException {
  public override readonly code = 'ALERT_RULE_CODE_DUPLICATE';

  constructor(code: string, params?: MessageParams) {
    super('metricsOps.error.ruleCodeDuplicate', 409, [], params ?? { code });
  }
}

export class AlertEventNotFoundException extends AppException {
  public override readonly code = 'ALERT_EVENT_NOT_FOUND';

  constructor(id: number, params?: MessageParams) {
    super('metricsOps.error.eventNotFound', 404, [], params ?? { id });
  }
}

export class AlertWebhookInvalidException extends AppException {
  public override readonly code = 'ALERT_WEBHOOK_INVALID';

  constructor() {
    super('metricsOps.error.invalidWebhookUrl', 400, []);
  }
}

export class SystemAlertRuleDeleteForbiddenException extends AppException {
  public override readonly code = 'SYSTEM_ALERT_RULE_DELETE_FORBIDDEN';

  constructor() {
    super('metricsOps.error.cannotDeleteSystemRule', 409, []);
  }
}

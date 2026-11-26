import { AppException, type MessageParams } from '@packages/kernel/index.js';

export class DrDisabledException extends AppException {
  public override readonly code = 'DR_DISABLED';

  constructor(detail = 'Disaster Recovery is disabled for this environment/profile') {
    super('drOps.error.disabled', 400, [], { detail });
  }
}

export class DrProfileNotFoundException extends AppException {
  public override readonly code = 'DR_PROFILE_NOT_FOUND';

  constructor(code: string, params?: MessageParams) {
    super('drOps.error.profileNotFound', 404, [], params ?? { code });
  }
}

export class DrSwitchNotFoundException extends AppException {
  public override readonly code = 'DR_SWITCH_NOT_FOUND';

  constructor(id: number | string) {
    super('drOps.error.switchNotFound', 404, [], { id: String(id) });
  }
}

export class DrSwitchGuardException extends AppException {
  public override readonly code = 'DR_SWITCH_GUARD_BLOCKED';

  constructor(reason: string) {
    super('drOps.error.switchGuardBlocked', 403, [], { reason });
  }
}

export class DrSplitBrainGuardException extends AppException {
  public override readonly code = 'DR_SPLIT_BRAIN_GUARD';

  constructor(reason: string) {
    super('drOps.error.splitBrainGuard', 409, [], { reason });
  }
}

export class DrValidationException extends AppException {
  public override readonly code = 'DR_VALIDATION_ERROR';

  constructor(detail: string) {
    super('drOps.error.validation', 400, [], { detail });
  }
}

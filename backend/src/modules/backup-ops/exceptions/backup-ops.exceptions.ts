import { AppException, type MessageParams } from '@packages/kernel/index.js';

export class BackupPolicyNotFoundException extends AppException {
  public override readonly code = 'BACKUP_POLICY_NOT_FOUND';

  constructor(identifier: string | number, params?: MessageParams) {
    super('backupOps.error.policyNotFound', 404, [], params ?? { identifier: String(identifier) });
  }
}

export class BackupPolicyCodeDuplicateException extends AppException {
  public override readonly code = 'BACKUP_POLICY_CODE_DUPLICATE';

  constructor(code: string) {
    super('backupOps.error.policyCodeDuplicate', 409, [], { code });
  }
}

export class BackupRecordNotFoundException extends AppException {
  public override readonly code = 'BACKUP_RECORD_NOT_FOUND';

  constructor(id: number | string) {
    super('backupOps.error.recordNotFound', 404, [], { id: String(id) });
  }
}

export class BackupInProgressException extends AppException {
  public override readonly code = 'BACKUP_IN_PROGRESS';

  constructor(targetType: string) {
    super('backupOps.error.inProgress', 409, [], { targetType });
  }
}

export class BackupEncryptionConfigException extends AppException {
  public override readonly code = 'BACKUP_ENCRYPTION_CONFIG_ERROR';

  constructor(message = 'BACKUP_ENCRYPTION_KEY is missing or invalid') {
    super('backupOps.error.encryptionConfig', 400, [], { message });
  }
}

export class BackupIntegrityException extends AppException {
  public override readonly code = 'BACKUP_INTEGRITY_FAILED';

  constructor(detail: string) {
    super('backupOps.error.integrityFailed', 422, [], { detail });
  }
}

export class BackupRestoreGuardException extends AppException {
  public override readonly code = 'BACKUP_RESTORE_GUARD_BLOCKED';

  constructor(reason: string) {
    super('backupOps.error.restoreGuardBlocked', 403, [], { reason });
  }
}

export class BackupValidationException extends AppException {
  public override readonly code = 'BACKUP_VALIDATION_ERROR';

  constructor(detail: string) {
    super('backupOps.error.validation', 400, [], { detail });
  }
}

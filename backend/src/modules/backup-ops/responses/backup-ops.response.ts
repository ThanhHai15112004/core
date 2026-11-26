import { safeJsonParseObject } from '@packages/kernel/index.js';
import type { BackupPolicyEntity } from '../entities/backup-policy.entity.js';
import type { BackupRecordEntity } from '../entities/backup-record.entity.js';
import type { BackupRestoreHistoryEntity } from '../entities/backup-restore-history.entity.js';
import type {
  BackupPolicyView,
  BackupRecordView,
  BackupRestoreHistoryView,
} from '../types/backup-ops.types.js';

export class BackupOpsResponseMapper {
  public static toPolicyView(entity: BackupPolicyEntity): BackupPolicyView {
    return {
      id: Number(entity.id),
      code: entity.code,
      name: entity.name,
      targetType: entity.targetType,
      scheduleCron: entity.scheduleCron,
      timezone: entity.timezone,
      isEnabled: Boolean(entity.isEnabled),
      encryptionEnabled: Boolean(entity.encryptionEnabled),
      compressionEnabled: Boolean(entity.compressionEnabled),
      retentionDays: Number(entity.retentionDays),
      maxKeepCount: Number(entity.maxKeepCount),
      autoVerifyDrill: Boolean(entity.autoVerifyDrill),
      alertOnFailure: Boolean(entity.alertOnFailure),
      staleThresholdHours: Number(entity.staleThresholdHours),
      storagePrefix: entity.storagePrefix,
      lastRunAt: entity.lastRunAt ? new Date(entity.lastRunAt).toISOString() : null,
      lastStatus: entity.lastStatus ?? null,
      nextRunAt: entity.nextRunAt ? new Date(entity.nextRunAt).toISOString() : null,
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
    };
  }

  public static toRecordView(entity: BackupRecordEntity): BackupRecordView {
    return {
      id: Number(entity.id),
      backupCode: entity.backupCode,
      policyId: entity.policyId !== null ? Number(entity.policyId) : null,
      policyCode: entity.policyCode ?? null,
      targetType: entity.targetType,
      triggerSource: entity.triggerSource,
      status: entity.status,
      engine: entity.engine ?? null,
      storageDriver: entity.storageDriver ?? null,
      storageKey: entity.storageKey ?? null,
      encrypted: Boolean(entity.encrypted),
      encryptionAlgorithm: entity.encryptionAlgorithm ?? null,
      compressed: Boolean(entity.compressed),
      originalSizeBytes:
        entity.originalSizeBytes !== null ? Number(entity.originalSizeBytes) : null,
      storedSizeBytes: entity.storedSizeBytes !== null ? Number(entity.storedSizeBytes) : null,
      plaintextSha256: entity.plaintextSha256 ?? null,
      artifactSha256: entity.artifactSha256 ?? null,
      retentionDays: Number(entity.retentionDays),
      expiresAt: entity.expiresAt ? new Date(entity.expiresAt).toISOString() : null,
      startedAt: new Date(entity.startedAt).toISOString(),
      completedAt: entity.completedAt ? new Date(entity.completedAt).toISOString() : null,
      durationMs: entity.durationMs !== null ? Number(entity.durationMs) : null,
      verifyStatus: entity.verifyStatus,
      lastVerifiedAt: entity.lastVerifiedAt ? new Date(entity.lastVerifiedAt).toISOString() : null,
      verifySummary: entity.verifySummaryJson
        ? safeJsonParseObject(entity.verifySummaryJson)
        : null,
      triggeredByUserId:
        entity.triggeredByUserId !== null ? Number(entity.triggeredByUserId) : null,
      triggeredByName: entity.triggeredByName ?? null,
      errorMessage: entity.errorMessage ?? null,
      metadata: entity.metadataJson ? safeJsonParseObject(entity.metadataJson) : null,
    };
  }

  public static toRestoreHistoryView(entity: BackupRestoreHistoryEntity): BackupRestoreHistoryView {
    return {
      id: Number(entity.id),
      restoreCode: entity.restoreCode,
      backupRecordId: entity.backupRecordId !== null ? Number(entity.backupRecordId) : null,
      backupCode: entity.backupCode ?? null,
      operationType: entity.operationType,
      scope: entity.scope,
      targetEnvironment: entity.targetEnvironment,
      targetDatabase: entity.targetDatabase ?? null,
      status: entity.status,
      verificationMode: entity.verificationMode ?? null,
      actorUserId: entity.actorUserId !== null ? Number(entity.actorUserId) : null,
      actorName: entity.actorName,
      reason: entity.reason,
      startedAt: new Date(entity.startedAt).toISOString(),
      completedAt: entity.completedAt ? new Date(entity.completedAt).toISOString() : null,
      durationMs: entity.durationMs !== null ? Number(entity.durationMs) : null,
      verificationResult: entity.verificationResultJson
        ? safeJsonParseObject(entity.verificationResultJson)
        : null,
      errorMessage: entity.errorMessage ?? null,
    };
  }
}

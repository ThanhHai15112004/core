import type { StorageDriverName } from '@packages/config/index.js';
import type {
  BackupRecordStatus,
  BackupTargetType,
  BackupTriggerSource,
  BackupVerifyStatus,
  RestoreOperationType,
  RestoreScope,
  RestoreStatus,
} from '../enum/backup-ops.enum.js';

export interface BackupPolicyView {
  readonly id: number;
  readonly code: string;
  readonly name: string;
  readonly targetType: BackupTargetType;
  readonly scheduleCron: string;
  readonly timezone: string;
  readonly isEnabled: boolean;
  readonly encryptionEnabled: boolean;
  readonly compressionEnabled: boolean;
  readonly retentionDays: number;
  readonly maxKeepCount: number;
  readonly autoVerifyDrill: boolean;
  readonly alertOnFailure: boolean;
  readonly staleThresholdHours: number;
  readonly storagePrefix: string;
  readonly lastRunAt: string | null;
  readonly lastStatus: string | null;
  readonly nextRunAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BackupRecordView {
  readonly id: number;
  readonly backupCode: string;
  readonly policyId: number | null;
  readonly policyCode: string | null;
  readonly targetType: BackupTargetType;
  readonly triggerSource: BackupTriggerSource;
  readonly status: BackupRecordStatus;
  readonly engine: string | null;
  readonly storageDriver: string | null;
  readonly storageKey: string | null;
  readonly encrypted: boolean;
  readonly encryptionAlgorithm: string | null;
  readonly compressed: boolean;
  readonly originalSizeBytes: number | null;
  readonly storedSizeBytes: number | null;
  readonly plaintextSha256: string | null;
  readonly artifactSha256: string | null;
  readonly retentionDays: number;
  readonly expiresAt: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly verifyStatus: BackupVerifyStatus;
  readonly lastVerifiedAt: string | null;
  readonly verifySummary: Record<string, unknown> | null;
  readonly triggeredByUserId: number | null;
  readonly triggeredByName: string | null;
  readonly errorMessage: string | null;
  readonly metadata: Record<string, unknown> | null;
}

export interface BackupRestoreHistoryView {
  readonly id: number;
  readonly restoreCode: string;
  readonly backupRecordId: number | null;
  readonly backupCode: string | null;
  readonly operationType: RestoreOperationType;
  readonly scope: RestoreScope;
  readonly targetEnvironment: string;
  readonly targetDatabase: string | null;
  readonly status: RestoreStatus;
  readonly verificationMode: string | null;
  readonly actorUserId: number | null;
  readonly actorName: string;
  readonly reason: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly durationMs: number | null;
  readonly verificationResult: Record<string, unknown> | null;
  readonly errorMessage: string | null;
}

export interface StorageVersioningStatusView {
  readonly driver: StorageDriverName;
  readonly supported: boolean;
  readonly status: 'enabled' | 'suspended' | 'disabled' | 'unsupported';
  readonly bucket: string | null;
}

export interface BackupOverviewView {
  readonly enabled: boolean;
  readonly healthStatus: 'healthy' | 'warning' | 'critical' | 'unknown';
  readonly encryptionConfigured: boolean;
  readonly encryptionEnabled: boolean;
  readonly restoreExecutionEnabled: boolean;
  readonly stalePoliciesCount: number;
  readonly totalRecords: number;
  readonly successfulRecords: number;
  readonly failedRecords24h: number;
  readonly totalStoredBytes: number;
  readonly drillTotalCount: number;
  readonly drillPassedCount: number;
  readonly latestDatabaseBackup: BackupRecordView | null;
  readonly latestStorageBackup: BackupRecordView | null;
  readonly storageVersioning: StorageVersioningStatusView;
  readonly policies: readonly BackupPolicyView[];
}

export interface BackupPruneResult {
  readonly scannedCount: number;
  readonly purgedCount: number;
  readonly purgedBackupCodes: readonly string[];
  readonly skippedLastGoodCount: number;
}

export interface BackupDrillResult {
  readonly record: BackupRecordView;
  readonly restoreHistory: BackupRestoreHistoryView;
  readonly passed: boolean;
  readonly verificationMode: string;
  readonly summary: Record<string, unknown>;
}

export interface BackupRunbookSection {
  readonly id: 'database' | 'storage' | 'secrets' | 'config';
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly string[];
  readonly commands: readonly string[];
  readonly warnings: readonly string[];
}

export interface BackupRunbookView {
  readonly version: string;
  readonly updatedAt: string;
  readonly docPath: string;
  readonly sections: readonly BackupRunbookSection[];
  readonly postRestoreChecklist: readonly string[];
}

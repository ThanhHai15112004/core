export type BackupTargetType = 'DATABASE' | 'STORAGE';
export type BackupRecordStatus = 'RUNNING' | 'SUCCESS' | 'FAILED' | 'EXPIRED' | 'PURGED';
export type BackupVerifyStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'SKIPPED';
export type RestoreOperationType = 'DRILL_ISOLATED' | 'MANUAL_RESTORE' | 'LIVE_RESTORE';
export type RestoreScope = 'DATABASE' | 'STORAGE' | 'SECRETS_CONFIG' | 'FULL';

export interface BackupPolicyDto {
  id: number;
  code: string;
  name: string;
  targetType: BackupTargetType;
  scheduleCron: string;
  timezone: string;
  isEnabled: boolean;
  encryptionEnabled: boolean;
  compressionEnabled: boolean;
  retentionDays: number;
  maxKeepCount: number;
  autoVerifyDrill: boolean;
  alertOnFailure: boolean;
  staleThresholdHours: number;
  storagePrefix: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  nextRunAt: string | null;
}

export interface BackupRecordDto {
  id: number;
  backupCode: string;
  policyId: number | null;
  policyCode: string | null;
  targetType: BackupTargetType;
  triggerSource: 'SCHEDULED' | 'MANUAL' | 'CLI';
  status: BackupRecordStatus;
  engine: string | null;
  storageDriver: string | null;
  storageKey: string | null;
  encrypted: boolean;
  encryptionAlgorithm: string | null;
  compressed: boolean;
  originalSizeBytes: number | null;
  storedSizeBytes: number | null;
  plaintextSha256: string | null;
  artifactSha256: string | null;
  retentionDays: number;
  expiresAt: string | null;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  verifyStatus: BackupVerifyStatus;
  lastVerifiedAt: string | null;
  verifySummary: Record<string, unknown> | null;
  triggeredByName: string | null;
  errorMessage: string | null;
}

export interface BackupRestoreHistoryDto {
  id: number;
  restoreCode: string;
  backupRecordId: number | null;
  backupCode: string | null;
  operationType: RestoreOperationType;
  scope: RestoreScope;
  targetEnvironment: string;
  targetDatabase: string | null;
  status: 'RUNNING' | 'SUCCESS' | 'FAILED';
  verificationMode: string | null;
  actorUserId: number | null;
  actorName: string;
  reason: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
}

export interface StorageVersioningDto {
  driver: string;
  supported: boolean;
  status: 'enabled' | 'suspended' | 'disabled' | 'unsupported';
  bucket: string | null;
}

export interface BackupOverviewDto {
  enabled: boolean;
  healthStatus: 'healthy' | 'warning' | 'critical' | 'unknown';
  encryptionConfigured: boolean;
  encryptionEnabled: boolean;
  restoreExecutionEnabled: boolean;
  stalePoliciesCount: number;
  totalRecords: number;
  successfulRecords: number;
  failedRecords24h: number;
  totalStoredBytes: number;
  drillTotalCount: number;
  drillPassedCount: number;
  latestDatabaseBackup: BackupRecordDto | null;
  latestStorageBackup: BackupRecordDto | null;
  storageVersioning: StorageVersioningDto;
  policies: BackupPolicyDto[];
}

export interface BackupRunbookSectionDto {
  id: 'database' | 'storage' | 'secrets' | 'config';
  title: string;
  summary: string;
  steps: string[];
  commands: string[];
  warnings: string[];
}

export interface BackupRunbookDto {
  version: string;
  updatedAt: string;
  docPath: string;
  sections: BackupRunbookSectionDto[];
  postRestoreChecklist: string[];
}

export interface PaginatedBackupList<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number | null;
    totalPages: number | null;
  };
}

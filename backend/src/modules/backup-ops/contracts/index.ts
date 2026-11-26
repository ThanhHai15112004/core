import type {
  BackupTargetType,
  BackupTriggerSource,
  RestoreScope,
} from '../enum/backup-ops.enum.js';
import type {
  BackupDrillResult,
  BackupOverviewView,
  BackupPruneResult,
  BackupRecordView,
  BackupRestoreHistoryView,
  StorageVersioningStatusView,
} from '../types/backup-ops.types.js';

export const BACKUP_OPS_PUBLIC_SERVICE = Symbol('BACKUP_OPS_PUBLIC_SERVICE');

export interface IBackupOpsPublicService {
  getOverview(): Promise<BackupOverviewView>;
  runBackup(input: {
    policyId?: number | undefined;
    policyCode?: string | undefined;
    targetType?: BackupTargetType | undefined;
    triggerSource: BackupTriggerSource;
    actorUserId?: number | null | undefined;
    actorName?: string | null | undefined;
    note?: string | undefined;
  }): Promise<BackupRecordView>;
  triggerDueScheduledBackups(now?: Date): Promise<{
    triggeredCount: number;
    staleCount: number;
    results: readonly { policyCode: string; status: string; backupCode?: string; error?: string }[];
  }>;
  pruneExpiredBackups(now?: Date): Promise<BackupPruneResult>;
  verifyBackupRecord(
    recordId: number,
    options?: {
      actorUserId?: number | null | undefined;
      actorName?: string | null | undefined;
      reason?: string | undefined;
    },
  ): Promise<BackupDrillResult>;
  runScheduledVerifyDrill(): Promise<BackupDrillResult | null>;
  getStorageVersioningStatus(): Promise<StorageVersioningStatusView>;
  enableStorageVersioning(actor?: {
    userId?: number | null;
    name?: string | null;
  }): Promise<StorageVersioningStatusView>;
  executeOrRecordRestore(input: {
    backupRecordId?: number | null | undefined;
    mode: 'RECORD_MANUAL' | 'EXECUTE_LIVE';
    scope: RestoreScope;
    targetEnvironment: string;
    targetDatabase?: string | null | undefined;
    actorUserId?: number | null | undefined;
    actorName: string;
    reason: string;
    confirm?: string | undefined;
  }): Promise<BackupRestoreHistoryView>;
}

import { randomUUID } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  BACKUP_DOMAIN_EVENTS,
  DomainEventBusService,
  defaultDomainEventBus,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { AuditLogService } from '@packages/security/index.js';
import { BaseStorageProvider } from '@packages/storage/index.js';
import {
  BACKUP_AUDIT_ACTIONS,
  BACKUP_RECORD_STATUS,
  BACKUP_TARGET_TYPE,
  BACKUP_VERIFY_STATUS,
  RESTORE_OPERATION_TYPE,
  RESTORE_STATUS,
  type RestoreScope,
} from '../enum/backup-ops.enum.js';
import {
  BackupIntegrityException,
  BackupRecordNotFoundException,
  BackupRestoreGuardException,
  BackupValidationException,
} from '../exceptions/backup-ops.exceptions.js';
import { decryptBackupPayload } from '../helpers/backup-crypto.helper.js';
import { BackupRecordRepository } from '../repositories/backup-record.repository.js';
import {
  BackupRestoreHistoryRepository,
  type ListRestoreHistoriesFilter,
} from '../repositories/backup-restore-history.repository.js';
import { BackupOpsResponseMapper } from '../responses/backup-ops.response.js';
import type { BackupDrillResult, BackupRestoreHistoryView } from '../types/backup-ops.types.js';
import { BackupAlertService } from './backup-alert.service.js';
import { DatabaseBackupEngineService } from './database-backup-engine.service.js';
import { StorageBackupService } from './storage-backup.service.js';

@Injectable()
export class BackupRestoreDrillService {
  private readonly eventBus: DomainEventBusService;

  constructor(
    private readonly config: CoreConfigService,
    private readonly storage: BaseStorageProvider,
    private readonly recordRepo: BackupRecordRepository,
    private readonly restoreHistoryRepo: BackupRestoreHistoryRepository,
    private readonly dbEngine: DatabaseBackupEngineService,
    private readonly storageBackup: StorageBackupService,
    private readonly alertService: BackupAlertService,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() eventBus?: DomainEventBusService,
  ) {
    this.eventBus = eventBus ?? defaultDomainEventBus;
  }

  /** Kiểm tra tự động bản backup (tải về → verify SHA-256 → giải mã → restore thử vào môi trường cô lập). */
  public async verifyBackupRecord(
    recordId: number,
    options?: {
      actorUserId?: number | null | undefined;
      actorName?: string | null | undefined;
      reason?: string | undefined;
    },
  ): Promise<BackupDrillResult> {
    const record = await this.recordRepo.findByIdSafe(recordId);
    if (!record) {
      throw new BackupRecordNotFoundException(recordId);
    }
    if (record.status !== BACKUP_RECORD_STATUS.SUCCESS || !record.storageKey) {
      throw new BackupIntegrityException(
        `Backup #${recordId} is not in SUCCESS state with a valid storage artifact`,
      );
    }

    const startedAt = new Date();
    const restoreCode = `DRL-${startedAt.toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const actorName = options?.actorName?.trim() || 'system-drill-scheduler';
    const reason =
      options?.reason?.trim() || 'Automated isolated restore drill verification (Section 13.6)';

    let history = await this.restoreHistoryRepo.saveEntity({
      restoreCode,
      backupRecordId: Number(record.id),
      backupCode: record.backupCode,
      operationType: RESTORE_OPERATION_TYPE.DRILL_ISOLATED,
      scope:
        record.targetType === BACKUP_TARGET_TYPE.STORAGE
          ? 'STORAGE'
          : 'DATABASE',
      targetEnvironment: `${this.config.app.env}-isolated-drill`,
      targetDatabase: this.config.backup.drillDatabase || null,
      status: RESTORE_STATUS.RUNNING,
      verificationMode: null,
      actorUserId: options?.actorUserId ?? null,
      actorName,
      reason,
      startedAt,
      completedAt: null,
      durationMs: null,
      verificationResultJson: null,
      errorMessage: null,
      metadataJson: JSON.stringify({ engine: record.engine, storageKey: record.storageKey }),
    });

    try {
      const artifact = await this.storage.download(record.storageKey);
      const plaintext = decryptBackupPayload(
        artifact,
        this.config.backup.encryptionKey,
        record.artifactSha256,
        record.plaintextSha256,
      );

      let verificationMode = 'STORAGE_SNAPSHOT_INTEGRITY';
      let summary: Record<string, unknown>;
      let targetDatabase: string | null = null;
      let passed = false;

      if (record.targetType === BACKUP_TARGET_TYPE.DATABASE) {
        const drillRes = await this.dbEngine.restoreToIsolatedDatabase(plaintext, record.engine);
        passed = drillRes.passed;
        verificationMode = drillRes.verificationMode;
        targetDatabase = drillRes.targetDatabase;
        summary = {
          passed: drillRes.passed,
          verificationMode: drillRes.verificationMode,
          targetDatabase: drillRes.targetDatabase,
          restoredTableCount: drillRes.restoredTableCount,
          migrationCount: drillRes.migrationCount,
          notes: drillRes.notes,
        };
      } else {
        const snapRes = this.storageBackup.verifyStorageSnapshot(plaintext);
        passed = snapRes.passed;
        summary = {
          passed: snapRes.passed,
          verificationMode,
          objectCount: snapRes.objectCount,
          totalBytes: snapRes.totalBytes,
        };
      }

      const completedAt = new Date();
      const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());

      record.verifyStatus = passed ? BACKUP_VERIFY_STATUS.PASSED : BACKUP_VERIFY_STATUS.FAILED;
      record.lastVerifiedAt = completedAt;
      record.verifySummaryJson = JSON.stringify(summary);
      const savedRecord = await this.recordRepo.saveEntity(record);

      history.status = passed ? RESTORE_STATUS.SUCCESS : RESTORE_STATUS.FAILED;
      history.verificationMode = verificationMode;
      history.targetDatabase = targetDatabase;
      history.completedAt = completedAt;
      history.durationMs = durationMs;
      history.verificationResultJson = JSON.stringify(summary);
      history = await this.restoreHistoryRepo.saveEntity(history);

      const eventType = passed
        ? BACKUP_DOMAIN_EVENTS.DRILL_PASSED
        : BACKUP_DOMAIN_EVENTS.DRILL_FAILED;
      await this.eventBus
        .publish({
          type: eventType,
          dotName: eventType,
          sourceModule: 'backup-ops',
          aggregateType: 'BackupRecord',
          aggregateId: record.backupCode,
          payload: {
            backupCode: record.backupCode,
            restoreCode,
            verificationMode,
            durationMs,
            summary,
          },
        })
        .catch(() => undefined);

      if (this.auditLog) {
        await this.auditLog
          .record({
            module: 'backup-ops',
            feature: 'restore_drill',
            action: BACKUP_AUDIT_ACTIONS.DRILL_EXECUTED,
            resourceType: 'BACKUP_RECORD',
            resourceId: String(record.id),
            actorUserId: options?.actorUserId ?? null,
            actorIdentifier: actorName,
            afterData: { restoreCode, passed, verificationMode, durationMs },
          })
          .catch(() => undefined);
      }

      return {
        record: BackupOpsResponseMapper.toRecordView(savedRecord),
        restoreHistory: BackupOpsResponseMapper.toRestoreHistoryView(history),
        passed,
        verificationMode,
        summary,
      };
    } catch (err) {
      const completedAt = new Date();
      const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
      const message = err instanceof Error ? err.message : String(err);

      record.verifyStatus = BACKUP_VERIFY_STATUS.FAILED;
      record.lastVerifiedAt = completedAt;
      record.verifySummaryJson = JSON.stringify({ passed: false, error: message });
      await this.recordRepo.saveEntity(record);

      history.status = RESTORE_STATUS.FAILED;
      history.completedAt = completedAt;
      history.durationMs = durationMs;
      history.errorMessage = message;
      await this.restoreHistoryRepo.saveEntity(history);

      await this.alertService.emitAlert({
        eventName: BACKUP_DOMAIN_EVENTS.DRILL_FAILED,
        alertCode: 'BACKUP_VERIFY_DRILL_FAILED',
        title: `Kiểm tra Restore Drill thất bại: ${record.backupCode}`,
        description: `Bản sao lưu ${record.backupCode} không vượt qua kiểm tra restore cô lập: ${message}`,
        severity: 'P1',
        backupCode: record.backupCode,
        policyCode: record.policyCode,
        targetType: record.targetType,
        metadata: { restoreCode, error: message },
      });

      throw err;
    }
  }

  /** Chạy Restore Drill định kỳ cho bản backup DB mới nhất chưa verify (hoặc gần nhất). */
  public async runScheduledVerifyDrill(): Promise<BackupDrillResult | null> {
    if (!this.config.backup.drillEnabled) return null;
    const candidate = await this.recordRepo.findLatestForVerifyDrill();
    if (!candidate) return null;
    return this.verifyBackupRecord(Number(candidate.id), {
      actorName: 'scheduler-verify-drill',
      reason: 'Scheduled automated backup verification drill',
    });
  }

  /** Ghi nhận hoặc thực thi thao tác Restore (bắt buộc có người thực hiện và lý do). */
  public async executeOrRecordRestore(input: {
    backupRecordId?: number | null | undefined;
    mode: 'RECORD_MANUAL' | 'EXECUTE_LIVE';
    scope: RestoreScope;
    targetEnvironment: string;
    targetDatabase?: string | null | undefined;
    actorUserId?: number | null | undefined;
    actorName: string;
    reason: string;
    confirm?: string | undefined;
  }): Promise<BackupRestoreHistoryView> {
    const reason = input.reason?.trim() ?? '';
    const actorName = input.actorName?.trim() ?? '';
    if (reason.length < 5) {
      throw new BackupValidationException('Restore reason must be at least 5 characters');
    }
    if (!actorName) {
      throw new BackupValidationException('Actor name is required for restore audit history');
    }

    let linkedRecord = null;
    if (input.backupRecordId !== undefined && input.backupRecordId !== null) {
      linkedRecord = await this.recordRepo.findByIdSafe(input.backupRecordId);
      if (!linkedRecord) {
        throw new BackupRecordNotFoundException(input.backupRecordId);
      }
    }

    if (input.mode === 'EXECUTE_LIVE') {
      if (input.confirm !== 'RESTORE') {
        throw new BackupRestoreGuardException('Confirmation string "RESTORE" is required');
      }
      if (!linkedRecord || !linkedRecord.storageKey) {
        throw new BackupValidationException(
          'A valid backupRecordId with storage artifact is required for EXECUTE_LIVE',
        );
      }
      if (!this.config.backup.restoreExecutionEnabled) {
        throw new BackupRestoreGuardException(
          'Live restore execution is disabled (BACKUP_RESTORE_EXECUTION_ENABLED=false)',
        );
      }
    }

    const startedAt = new Date();
    const restoreCode = `RST-${startedAt.toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`;

    let history = await this.restoreHistoryRepo.saveEntity({
      restoreCode,
      backupRecordId: linkedRecord ? Number(linkedRecord.id) : null,
      backupCode: linkedRecord?.backupCode ?? null,
      operationType:
        input.mode === 'EXECUTE_LIVE'
          ? RESTORE_OPERATION_TYPE.LIVE_RESTORE
          : RESTORE_OPERATION_TYPE.MANUAL_RESTORE,
      scope: input.scope,
      targetEnvironment: input.targetEnvironment.trim(),
      targetDatabase: input.targetDatabase?.trim() || null,
      status: input.mode === 'EXECUTE_LIVE' ? RESTORE_STATUS.RUNNING : RESTORE_STATUS.SUCCESS,
      verificationMode: input.mode === 'EXECUTE_LIVE' ? 'LIVE_EXECUTION' : 'OPERATOR_ATTESTED',
      actorUserId: input.actorUserId ?? null,
      actorName,
      reason,
      startedAt,
      completedAt: input.mode === 'EXECUTE_LIVE' ? null : startedAt,
      durationMs: input.mode === 'EXECUTE_LIVE' ? null : 0,
      verificationResultJson: null,
      errorMessage: null,
      metadataJson: JSON.stringify({ mode: input.mode }),
    });

    if (input.mode === 'EXECUTE_LIVE' && linkedRecord && linkedRecord.storageKey) {
      try {
        const artifact = await this.storage.download(linkedRecord.storageKey);
        const plaintext = decryptBackupPayload(
          artifact,
          this.config.backup.encryptionKey,
          linkedRecord.artifactSha256,
          linkedRecord.plaintextSha256,
        );

        let resultSummary: Record<string, unknown>;
        if (input.scope === 'STORAGE') {
          resultSummary = await this.storageBackup.restoreStorageSnapshot(plaintext);
        } else {
          resultSummary = await this.dbEngine.executeLiveRestore(plaintext, linkedRecord.engine);
        }

        const completedAt = new Date();
        history.status = RESTORE_STATUS.SUCCESS;
        history.completedAt = completedAt;
        history.durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
        history.verificationResultJson = JSON.stringify(resultSummary);
        history = await this.restoreHistoryRepo.saveEntity(history);
      } catch (err) {
        const completedAt = new Date();
        history.status = RESTORE_STATUS.FAILED;
        history.completedAt = completedAt;
        history.durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
        history.errorMessage = err instanceof Error ? err.message : String(err);
        await this.restoreHistoryRepo.saveEntity(history);
        throw err;
      }
    }

    await this.eventBus
      .publish({
        type: BACKUP_DOMAIN_EVENTS.RESTORE_RECORDED,
        dotName: BACKUP_DOMAIN_EVENTS.RESTORE_RECORDED,
        sourceModule: 'backup-ops',
        aggregateType: 'BackupRestore',
        aggregateId: history.restoreCode,
        payload: {
          restoreCode: history.restoreCode,
          backupCode: history.backupCode,
          operationType: history.operationType,
          scope: history.scope,
          targetEnvironment: history.targetEnvironment,
          actorName,
          reason,
          status: history.status,
        },
      })
      .catch(() => undefined);

    if (this.auditLog) {
      await this.auditLog
        .record({
          module: 'backup-ops',
          feature: 'restore_audit',
          action:
            input.mode === 'EXECUTE_LIVE'
              ? BACKUP_AUDIT_ACTIONS.RESTORE_EXECUTED
              : BACKUP_AUDIT_ACTIONS.RESTORE_RECORDED,
          resourceType: 'BACKUP_RESTORE',
          resourceId: history.restoreCode,
          actorUserId: input.actorUserId ?? null,
          actorIdentifier: actorName,
          afterData: {
            restoreCode: history.restoreCode,
            backupCode: history.backupCode,
            scope: history.scope,
            targetEnvironment: history.targetEnvironment,
            reason,
            status: history.status,
          },
        })
        .catch(() => undefined);
    }

    return BackupOpsResponseMapper.toRestoreHistoryView(history);
  }

  public async listRestoreHistories(
    filter: ListRestoreHistoriesFilter,
  ): Promise<PaginatedResult<BackupRestoreHistoryView>> {
    const page = await this.restoreHistoryRepo.listPaginated(filter);
    return {
      ...page,
      data: page.data.map((item) => BackupOpsResponseMapper.toRestoreHistoryView(item)),
    };
  }
}

import { randomUUID } from 'node:crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { CoreConfigService } from '@packages/config/index.js';
import {
  BACKUP_HISTORY_SIZE,
  databaseKeys,
  type DbBackupReportRecord,
} from '@packages/database/index.js';
import {
  BACKUP_DOMAIN_EVENTS,
  DomainEventBusService,
  defaultDomainEventBus,
  type PaginatedResult,
} from '@packages/kernel/index.js';
import { RedisService } from '@packages/redis/index.js';
import { AuditLogService } from '@packages/security/index.js';
import { BaseStorageProvider } from '@packages/storage/index.js';
import type { IBackupOpsPublicService } from '../contracts/index.js';
import {
  BACKUP_AUDIT_ACTIONS,
  BACKUP_RECORD_STATUS,
  BACKUP_TARGET_TYPE,
  BACKUP_TRIGGER_SOURCE,
  BACKUP_VERIFY_STATUS,
  type BackupTargetType,
  type BackupTriggerSource,
} from '../enum/backup-ops.enum.js';
import {
  BackupInProgressException,
  BackupPolicyCodeDuplicateException,
  BackupPolicyNotFoundException,
  BackupRecordNotFoundException,
} from '../exceptions/backup-ops.exceptions.js';
import { encryptBackupPayload } from '../helpers/backup-crypto.helper.js';
import { computeNextRunAt, isCronDue } from '../helpers/backup-cron.helper.js';
import { buildBackupRunbook } from '../helpers/backup-runbook.helper.js';
import { BackupPolicyRepository } from '../repositories/backup-policy.repository.js';
import {
  BackupRecordRepository,
  type ListBackupRecordsFilter,
} from '../repositories/backup-record.repository.js';
import type {
  CreateBackupPolicyRequest,
  UpdateBackupPolicyRequest,
} from '../requests/backup-ops.requests.js';
import { BackupOpsResponseMapper } from '../responses/backup-ops.response.js';
import type {
  BackupOverviewView,
  BackupPolicyView,
  BackupPruneResult,
  BackupRecordView,
  BackupRunbookView,
  StorageVersioningStatusView,
} from '../types/backup-ops.types.js';
import { BackupAlertService } from './backup-alert.service.js';
import { BackupRestoreDrillService } from './backup-restore-drill.service.js';
import { DatabaseBackupEngineService } from './database-backup-engine.service.js';
import { StorageBackupService } from './storage-backup.service.js';

const LOCK_TTL_SEC = 600;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class BackupOrchestratorService implements IBackupOpsPublicService {
  private readonly logger = new Logger(BackupOrchestratorService.name);
  private readonly eventBus: DomainEventBusService;
  private readonly activeLocalLocks = new Set<string>();

  constructor(
    private readonly config: CoreConfigService,
    private readonly storage: BaseStorageProvider,
    private readonly policyRepo: BackupPolicyRepository,
    private readonly recordRepo: BackupRecordRepository,
    private readonly dbEngine: DatabaseBackupEngineService,
    private readonly storageBackup: StorageBackupService,
    private readonly drillService: BackupRestoreDrillService,
    private readonly alertService: BackupAlertService,
    @Optional() private readonly redis?: RedisService,
    @Optional() private readonly auditLog?: AuditLogService,
    @Optional() eventBus?: DomainEventBusService,
  ) {
    this.eventBus = eventBus ?? defaultDomainEventBus;
  }

  public async getOverview(): Promise<BackupOverviewView> {
    const [policies, stats, latestDb, latestStorage, versioning] = await Promise.all([
      this.policyRepo.listAll(),
      this.recordRepo.getStatsSnapshot(),
      this.recordRepo.findLatestByTarget(BACKUP_TARGET_TYPE.DATABASE),
      this.recordRepo.findLatestByTarget(BACKUP_TARGET_TYPE.STORAGE),
      this.storageBackup.getVersioningStatus().catch((): StorageVersioningStatusView => ({
        driver: this.storage.driverName,
        supported: false,
        status: 'unsupported',
        bucket: null,
      })),
    ]);

    const nowMs = Date.now();
    let stalePoliciesCount = 0;
    for (const p of policies) {
      if (!p.isEnabled) continue;
      if (!p.lastRunAt) continue;
      const ageHours = (nowMs - new Date(p.lastRunAt).getTime()) / 3_600_000;
      if (ageHours > p.staleThresholdHours) stalePoliciesCount++;
    }

    let healthStatus: BackupOverviewView['healthStatus'] = 'unknown';
    if (stats.failedRecords24h > 0 || latestDb?.status === BACKUP_RECORD_STATUS.FAILED) {
      healthStatus = 'critical';
    } else if (stalePoliciesCount > 0 || latestDb?.verifyStatus === BACKUP_VERIFY_STATUS.FAILED) {
      healthStatus = 'warning';
    } else if (latestDb?.status === BACKUP_RECORD_STATUS.SUCCESS) {
      healthStatus = 'healthy';
    }

    return {
      enabled: this.config.backup.enabled,
      healthStatus,
      encryptionConfigured: this.config.backup.encryptionKey.trim().length >= 16,
      encryptionEnabled: this.config.backup.encryptionEnabled,
      restoreExecutionEnabled: this.config.backup.restoreExecutionEnabled,
      stalePoliciesCount,
      totalRecords: stats.totalRecords,
      successfulRecords: stats.successfulRecords,
      failedRecords24h: stats.failedRecords24h,
      totalStoredBytes: stats.totalStoredBytes,
      drillTotalCount: stats.drillTotalCount,
      drillPassedCount: stats.drillPassedCount,
      latestDatabaseBackup: latestDb ? BackupOpsResponseMapper.toRecordView(latestDb) : null,
      latestStorageBackup: latestStorage
        ? BackupOpsResponseMapper.toRecordView(latestStorage)
        : null,
      storageVersioning: versioning,
      policies: policies.map((p) => BackupOpsResponseMapper.toPolicyView(p)),
    };
  }

  public async listPolicies(): Promise<BackupPolicyView[]> {
    const rows = await this.policyRepo.listAll();
    return rows.map((row) => BackupOpsResponseMapper.toPolicyView(row));
  }

  public async createPolicy(input: CreateBackupPolicyRequest): Promise<BackupPolicyView> {
    const existing = await this.policyRepo.findByCodeSafe(input.code);
    if (existing) {
      throw new BackupPolicyCodeDuplicateException(input.code);
    }
    const entity = await this.policyRepo.saveEntity({
      code: input.code,
      name: input.name,
      targetType: input.targetType,
      scheduleCron: input.scheduleCron,
      timezone: input.timezone,
      isEnabled: input.isEnabled,
      encryptionEnabled: input.encryptionEnabled,
      compressionEnabled: input.compressionEnabled,
      retentionDays: input.retentionDays,
      maxKeepCount: input.maxKeepCount,
      autoVerifyDrill: input.autoVerifyDrill,
      alertOnFailure: input.alertOnFailure,
      staleThresholdHours: input.staleThresholdHours,
      storagePrefix: input.storagePrefix,
      nextRunAt: computeNextRunAt(input.scheduleCron),
    });

    await this.auditLog
      ?.record({
        module: 'backup-ops',
        feature: 'backup_policies',
        action: BACKUP_AUDIT_ACTIONS.POLICY_CREATED,
        resourceType: 'BACKUP_POLICY',
        resourceId: entity.code,
        afterData: {
          code: entity.code,
          targetType: entity.targetType,
          scheduleCron: entity.scheduleCron,
        },
      })
      .catch(() => undefined);

    return BackupOpsResponseMapper.toPolicyView(entity);
  }

  public async updatePolicy(
    id: number,
    input: UpdateBackupPolicyRequest,
  ): Promise<BackupPolicyView> {
    const entity = await this.policyRepo.findByIdSafe(id);
    if (!entity) {
      throw new BackupPolicyNotFoundException(id);
    }

    if (input.name !== undefined) entity.name = input.name;
    if (input.scheduleCron !== undefined) {
      entity.scheduleCron = input.scheduleCron;
      entity.nextRunAt = computeNextRunAt(input.scheduleCron);
    }
    if (input.timezone !== undefined) entity.timezone = input.timezone;
    if (input.isEnabled !== undefined) entity.isEnabled = input.isEnabled;
    if (input.encryptionEnabled !== undefined) entity.encryptionEnabled = input.encryptionEnabled;
    if (input.compressionEnabled !== undefined)
      entity.compressionEnabled = input.compressionEnabled;
    if (input.retentionDays !== undefined) entity.retentionDays = input.retentionDays;
    if (input.maxKeepCount !== undefined) entity.maxKeepCount = input.maxKeepCount;
    if (input.autoVerifyDrill !== undefined) entity.autoVerifyDrill = input.autoVerifyDrill;
    if (input.alertOnFailure !== undefined) entity.alertOnFailure = input.alertOnFailure;
    if (input.staleThresholdHours !== undefined)
      entity.staleThresholdHours = input.staleThresholdHours;
    if (input.storagePrefix !== undefined) entity.storagePrefix = input.storagePrefix;

    const saved = await this.policyRepo.saveEntity(entity);
    await this.auditLog
      ?.record({
        module: 'backup-ops',
        feature: 'backup_policies',
        action: BACKUP_AUDIT_ACTIONS.POLICY_UPDATED,
        resourceType: 'BACKUP_POLICY',
        resourceId: saved.code,
        afterData: {
          scheduleCron: saved.scheduleCron,
          isEnabled: saved.isEnabled,
          retentionDays: saved.retentionDays,
        },
      })
      .catch(() => undefined);

    return BackupOpsResponseMapper.toPolicyView(saved);
  }

  public async listRecords(
    filter: ListBackupRecordsFilter,
  ): Promise<PaginatedResult<BackupRecordView>> {
    const page = await this.recordRepo.listPaginated(filter);
    return {
      ...page,
      data: page.data.map((r) => BackupOpsResponseMapper.toRecordView(r)),
    };
  }

  public async getRecordById(id: number): Promise<BackupRecordView> {
    const record = await this.recordRepo.findByIdSafe(id);
    if (!record) throw new BackupRecordNotFoundException(id);
    return BackupOpsResponseMapper.toRecordView(record);
  }

  private async acquireRunLock(lockName: string): Promise<string | null> {
    const token = randomUUID();
    if (this.redis?.isReady()) {
      const ok = await this.redis.client.set(
        this.redis.key('backup', 'lock', lockName),
        token,
        'EX',
        LOCK_TTL_SEC,
        'NX',
      );
      if (ok !== 'OK') return null;
      return token;
    }
    if (this.activeLocalLocks.has(lockName)) return null;
    this.activeLocalLocks.add(lockName);
    return token;
  }

  private async releaseRunLock(lockName: string, token: string): Promise<void> {
    this.activeLocalLocks.delete(lockName);
    if (this.redis?.isReady()) {
      const key = this.redis.key('backup', 'lock', lockName);
      const current = await this.redis.client.get(key).catch(() => null);
      if (current === token) {
        await this.redis.client.del(key).catch(() => undefined);
      }
    }
  }

  /** Thực thi sao lưu Database hoặc Object Storage, mã hóa, upload và đồng bộ trạng thái. */
  public async runBackup(input: {
    policyId?: number | undefined;
    policyCode?: string | undefined;
    targetType?: BackupTargetType | undefined;
    triggerSource: BackupTriggerSource;
    actorUserId?: number | null | undefined;
    actorName?: string | null | undefined;
    note?: string | undefined;
  }): Promise<BackupRecordView> {
    let policy = null;
    if (input.policyId) {
      policy = await this.policyRepo.findByIdSafe(input.policyId);
      if (!policy) throw new BackupPolicyNotFoundException(input.policyId);
    } else if (input.policyCode) {
      policy = await this.policyRepo.findByCodeSafe(input.policyCode);
      if (!policy) throw new BackupPolicyNotFoundException(input.policyCode);
    } else if (input.targetType) {
      policy = await this.policyRepo.findFirstEnabledByTarget(input.targetType);
    } else {
      policy = await this.policyRepo.findFirstEnabledByTarget(BACKUP_TARGET_TYPE.DATABASE);
    }

    const targetType = input.targetType ?? policy?.targetType ?? BACKUP_TARGET_TYPE.DATABASE;
    const lockToken = await this.acquireRunLock(targetType.toLowerCase());
    if (!lockToken) {
      throw new BackupInProgressException(targetType);
    }

    const startedAt = new Date();
    const dateSlug = startedAt.toISOString().slice(0, 10);
    const backupCode = `BKP-${targetType === BACKUP_TARGET_TYPE.DATABASE ? 'DB' : 'STG'}-${dateSlug.replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
    const retentionDays = policy?.retentionDays ?? this.config.backup.defaultRetentionDays;
    const encrypt = policy ? policy.encryptionEnabled : this.config.backup.encryptionEnabled;
    const compress = policy ? policy.compressionEnabled : true;
    const storagePrefix = (policy?.storagePrefix || this.config.backup.storagePrefix).replace(
      /^\/+|\/+$/g,
      '',
    );

    let record = await this.recordRepo.saveEntity({
      backupCode,
      policyId: policy ? Number(policy.id) : null,
      policyCode: policy?.code ?? null,
      targetType,
      triggerSource: input.triggerSource,
      status: BACKUP_RECORD_STATUS.RUNNING,
      engine: null,
      storageDriver: this.storage.driverName,
      storageKey: null,
      encrypted: encrypt,
      encryptionAlgorithm: null,
      compressed: compress,
      originalSizeBytes: null,
      storedSizeBytes: null,
      plaintextSha256: null,
      artifactSha256: null,
      retentionDays,
      expiresAt: new Date(startedAt.getTime() + retentionDays * DAY_MS),
      startedAt,
      completedAt: null,
      durationMs: null,
      verifyStatus: BACKUP_VERIFY_STATUS.PENDING,
      triggeredByUserId: input.actorUserId ?? null,
      triggeredByName: input.actorName ?? input.triggerSource,
      errorMessage: null,
      metadataJson: input.note ? JSON.stringify({ note: input.note }) : null,
    });

    try {
      let plainPayload: Buffer;
      let engine: string;
      let extraMeta: Record<string, unknown> = input.note ? { note: input.note } : {};

      if (targetType === BACKUP_TARGET_TYPE.DATABASE) {
        const dump = await this.dbEngine.dumpDatabase();
        plainPayload = dump.payload;
        engine = dump.engine;
        extraMeta = {
          ...extraMeta,
          tableCount: dump.tableCount,
          rowCountEstimate: dump.rowCountEstimate,
        };
      } else {
        const snap = await this.storageBackup.createStorageSnapshot(storagePrefix);
        plainPayload = snap.payload;
        engine = 'storage-snapshot-v1';
        extraMeta = {
          ...extraMeta,
          objectCount: snap.objectCount,
          totalPlainBytes: snap.totalPlainBytes,
          truncated: snap.truncated,
        };
      }

      const packed = encryptBackupPayload(plainPayload, this.config.backup.encryptionKey, {
        encrypt,
        compress,
      });

      const storageKey = `${storagePrefix}/${targetType.toLowerCase()}/${dateSlug}/${backupCode}.cbkp`;
      await this.storage.upload(storageKey, packed.artifact, 'application/octet-stream');

      const completedAt = new Date();
      const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());

      record.status = BACKUP_RECORD_STATUS.SUCCESS;
      record.engine = engine;
      record.storageKey = storageKey;
      record.encrypted = packed.encrypted;
      record.encryptionAlgorithm = packed.encryptionAlgorithm;
      record.compressed = packed.compressed;
      record.originalSizeBytes = packed.originalSizeBytes;
      record.storedSizeBytes = packed.storedSizeBytes;
      record.plaintextSha256 = packed.plaintextSha256;
      record.artifactSha256 = packed.artifactSha256;
      record.completedAt = completedAt;
      record.durationMs = durationMs;
      record.metadataJson = JSON.stringify(extraMeta);
      record = await this.recordRepo.saveEntity(record);

      if (policy) {
        policy.lastRunAt = completedAt;
        policy.lastStatus = BACKUP_RECORD_STATUS.SUCCESS;
        policy.nextRunAt = computeNextRunAt(policy.scheduleCron, completedAt);
        await this.policyRepo.saveEntity(policy);
      }

      if (targetType === BACKUP_TARGET_TYPE.DATABASE) {
        await this.syncDatabaseOpsBackupStatus({
          id: record.backupCode,
          at: completedAt.toISOString(),
          status: 'success',
          durationMs,
          sizeBytes: packed.storedSizeBytes,
          location: storageKey,
          provider: `${this.storage.driverName}:${engine}`,
          retentionDays,
          nextScheduledAt: policy?.nextRunAt ? policy.nextRunAt.toISOString() : null,
          error: null,
          reportedBy: input.actorName ?? 'backup-ops',
        });
      }

      await this.eventBus
        .publish({
          type: BACKUP_DOMAIN_EVENTS.COMPLETED,
          dotName: BACKUP_DOMAIN_EVENTS.COMPLETED,
          sourceModule: 'backup-ops',
          aggregateType: 'BackupRecord',
          aggregateId: record.backupCode,
          payload: {
            backupCode: record.backupCode,
            targetType,
            engine,
            storageKey,
            storedSizeBytes: packed.storedSizeBytes,
            encrypted: packed.encrypted,
          },
        })
        .catch(() => undefined);

      if (policy?.autoVerifyDrill && targetType === BACKUP_TARGET_TYPE.DATABASE) {
        await this.drillService
          .verifyBackupRecord(Number(record.id), {
            actorUserId: input.actorUserId ?? null,
            actorName: input.actorName ?? 'auto-verify-drill',
            reason: `Auto verify drill after ${record.backupCode}`,
          })
          .catch((drillErr) => {
            this.logger.warn(
              `Auto verify drill failed for ${record.backupCode}: ${drillErr instanceof Error ? drillErr.message : String(drillErr)}`,
            );
          });
        record = (await this.recordRepo.findByIdSafe(Number(record.id))) ?? record;
      }

      return BackupOpsResponseMapper.toRecordView(record);
    } catch (err) {
      const completedAt = new Date();
      const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
      const message = err instanceof Error ? err.message : String(err);

      record.status = BACKUP_RECORD_STATUS.FAILED;
      record.completedAt = completedAt;
      record.durationMs = durationMs;
      record.errorMessage = message;
      await this.recordRepo.saveEntity(record);

      if (policy) {
        policy.lastRunAt = completedAt;
        policy.lastStatus = BACKUP_RECORD_STATUS.FAILED;
        policy.nextRunAt = computeNextRunAt(policy.scheduleCron, completedAt);
        await this.policyRepo.saveEntity(policy);
      }

      if (targetType === BACKUP_TARGET_TYPE.DATABASE) {
        await this.syncDatabaseOpsBackupStatus({
          id: record.backupCode,
          at: completedAt.toISOString(),
          status: 'failed',
          durationMs,
          sizeBytes: null,
          location: null,
          provider: this.storage.driverName,
          retentionDays,
          nextScheduledAt: policy?.nextRunAt ? policy.nextRunAt.toISOString() : null,
          error: message.slice(0, 480),
          reportedBy: input.actorName ?? 'backup-ops',
        });
      }

      if (!policy || policy.alertOnFailure) {
        await this.alertService.emitAlert({
          eventName: BACKUP_DOMAIN_EVENTS.FAILED,
          alertCode: 'BACKUP_EXECUTION_FAILED',
          title: `Sao lưu ${targetType} thất bại (${backupCode})`,
          description: `Quá trình sao lưu ${targetType} gặp lỗi: ${message}`,
          severity: 'P1',
          backupCode,
          policyCode: policy?.code ?? null,
          targetType,
          metadata: { error: message, durationMs },
        });
      }

      throw err;
    } finally {
      await this.releaseRunLock(targetType.toLowerCase(), lockToken);
    }
  }

  /** Quét các chính sách đến hạn theo Cron và kiểm tra chính sách quá hạn (stale). */
  public async triggerDueScheduledBackups(now: Date = new Date()): Promise<{
    triggeredCount: number;
    staleCount: number;
    results: readonly { policyCode: string; status: string; backupCode?: string; error?: string }[];
  }> {
    if (!this.config.backup.enabled) {
      return { triggeredCount: 0, staleCount: 0, results: [] };
    }

    const policies = await this.policyRepo.listEnabled();
    const results: Array<{
      policyCode: string;
      status: string;
      backupCode?: string;
      error?: string;
    }> = [];
    let triggeredCount = 0;

    for (const policy of policies) {
      if (!isCronDue(policy.scheduleCron, policy.lastRunAt, now)) {
        continue;
      }
      try {
        const record = await this.runBackup({
          policyId: Number(policy.id),
          triggerSource: BACKUP_TRIGGER_SOURCE.SCHEDULED,
          actorName: 'scheduler',
        });
        triggeredCount++;
        results.push({ policyCode: policy.code, status: 'SUCCESS', backupCode: record.backupCode });
      } catch (err) {
        results.push({
          policyCode: policy.code,
          status: 'FAILED',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const staleCount = await this.checkStaleBackups(now);
    return { triggeredCount, staleCount, results };
  }

  /** Cảnh báo nếu chính sách đang bật bị quá hạn sao lưu (`staleThresholdHours`). */
  public async checkStaleBackups(now: Date = new Date()): Promise<number> {
    const policies = await this.policyRepo.listEnabled();
    let staleCount = 0;
    for (const p of policies) {
      if (!p.lastRunAt) continue;
      const ageHours = (now.getTime() - new Date(p.lastRunAt).getTime()) / 3_600_000;
      if (ageHours > p.staleThresholdHours) {
        staleCount++;
        if (p.alertOnFailure) {
          await this.alertService.emitAlert({
            eventName: BACKUP_DOMAIN_EVENTS.STALE,
            alertCode: 'BACKUP_SCHEDULE_STALE',
            title: `Chính sách sao lưu quá hạn: ${p.code}`,
            description: `Chính sách ${p.name} (${p.code}) đã ${Math.round(ageHours)}h chưa có bản sao lưu mới (ngưỡng ${p.staleThresholdHours}h).`,
            severity: 'P2',
            policyCode: p.code,
            targetType: p.targetType,
            metadata: { ageHours: Math.round(ageHours), thresholdHours: p.staleThresholdHours },
          });
        }
      }
    }
    return staleCount;
  }

  /**
   * Dọn các bản backup hết hạn theo `expiresAt` và `maxKeepCount` của từng policy/target.
   * Luôn giữ lại ít nhất 1 bản SUCCESS mới nhất cho mỗi nhóm để không bao giờ xóa trắng điểm khôi phục.
   */
  public async pruneExpiredBackups(now: Date = new Date()): Promise<BackupPruneResult> {
    const [policies, records] = await Promise.all([
      this.policyRepo.listAll(),
      this.recordRepo.listSuccessfulRecords(),
    ]);

    const policyByCode = new Map(policies.map((p) => [p.code, p]));
    const groups = new Map<string, typeof records>();

    for (const r of records) {
      const groupKey = r.policyCode ?? `__NO_POLICY_${r.targetType}`;
      const list = groups.get(groupKey) ?? [];
      list.push(r);
      groups.set(groupKey, list);
    }

    const purgedBackupCodes: string[] = [];
    let skippedLastGoodCount = 0;

    for (const [groupKey, groupRecords] of groups.entries()) {
      const policy = policyByCode.get(groupKey);
      const maxKeep = policy?.maxKeepCount ?? this.config.backup.defaultMaxKeepCount;

      for (let idx = 0; idx < groupRecords.length; idx++) {
        const rec = groupRecords[idx]!;
        if (idx === 0) {
          // Luôn giữ lại bản SUCCESS mới nhất của nhóm
          if (rec.expiresAt && new Date(rec.expiresAt).getTime() <= now.getTime()) {
            skippedLastGoodCount++;
          }
          continue;
        }

        const isExpiredByAge =
          rec.expiresAt !== null && new Date(rec.expiresAt).getTime() <= now.getTime();
        const exceedsMaxCount = idx >= maxKeep;

        if (!isExpiredByAge && !exceedsMaxCount) continue;

        if (rec.storageKey) {
          await this.storage.delete(rec.storageKey).catch((err) => {
            this.logger.warn(
              `Failed deleting expired backup object ${rec.storageKey}: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
        }

        rec.status = BACKUP_RECORD_STATUS.PURGED;
        await this.recordRepo.saveEntity(rec);
        purgedBackupCodes.push(rec.backupCode);
      }
    }

    if (purgedBackupCodes.length > 0) {
      await this.eventBus
        .publish({
          type: BACKUP_DOMAIN_EVENTS.PRUNED,
          dotName: BACKUP_DOMAIN_EVENTS.PRUNED,
          sourceModule: 'backup-ops',
          aggregateType: 'BackupRetention',
          aggregateId: 'retention-prune',
          payload: { purgedCount: purgedBackupCodes.length, purgedBackupCodes },
        })
        .catch(() => undefined);

      await this.auditLog
        ?.record({
          module: 'backup-ops',
          feature: 'backup_retention',
          action: BACKUP_AUDIT_ACTIONS.BACKUP_PRUNED,
          resourceType: 'BACKUP_RETENTION',
          resourceId: 'retention-prune',
          afterData: { purgedCount: purgedBackupCodes.length, purgedBackupCodes },
        })
        .catch(() => undefined);
    }

    return {
      scannedCount: records.length,
      purgedCount: purgedBackupCodes.length,
      purgedBackupCodes,
      skippedLastGoodCount,
    };
  }

  public getStorageVersioningStatus(): Promise<StorageVersioningStatusView> {
    return this.storageBackup.getVersioningStatus();
  }

  public async enableStorageVersioning(actor?: {
    userId?: number | null;
    name?: string | null;
  }): Promise<StorageVersioningStatusView> {
    const res = await this.storageBackup.enableBucketVersioning();
    await this.auditLog
      ?.record({
        module: 'backup-ops',
        feature: 'storage_versioning',
        action: BACKUP_AUDIT_ACTIONS.STORAGE_VERSIONING_ENABLED,
        resourceType: 'STORAGE_BUCKET',
        resourceId: res.bucket ?? res.driver,
        actorUserId: actor?.userId ?? null,
        actorIdentifier: actor?.name ?? null,
        afterData: res,
      })
      .catch(() => undefined);
    return res;
  }

  public verifyBackupRecord(
    recordId: number,
    options?: {
      actorUserId?: number | null | undefined;
      actorName?: string | null | undefined;
      reason?: string | undefined;
    },
  ) {
    return this.drillService.verifyBackupRecord(recordId, options);
  }

  public runScheduledVerifyDrill() {
    return this.drillService.runScheduledVerifyDrill();
  }

  public executeOrRecordRestore(
    input: Parameters<BackupRestoreDrillService['executeOrRecordRestore']>[0],
  ) {
    return this.drillService.executeOrRecordRestore(input);
  }

  public getRunbook(): BackupRunbookView {
    return buildBackupRunbook();
  }

  /** Đồng bộ kết quả backup DB gần nhất sang Redis để tab Database Monitor (`database-ops`) giữ tương thích ngược. */
  private async syncDatabaseOpsBackupStatus(record: DbBackupReportRecord): Promise<void> {
    if (!this.redis?.isReady()) return;
    try {
      const keys = databaseKeys(this.redis);
      const json = JSON.stringify(record);
      await this.redis.client
        .multi()
        .set(keys.backupStatus(), json)
        .lpush(keys.backupHistory(), json)
        .ltrim(keys.backupHistory(), 0, BACKUP_HISTORY_SIZE - 1)
        .exec();
    } catch {
      // Best-effort sync with database-ops Redis dashboard
    }
  }
}

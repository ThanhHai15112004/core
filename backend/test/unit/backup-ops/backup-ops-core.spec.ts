import { describe, expect, it, jest } from '@jest/globals';
import type { CoreConfigService } from '@packages/config/index.js';
import type { DatabaseConnectionService } from '@packages/database/index.js';
import { BACKUP_DOMAIN_EVENTS, DomainEventBusService } from '@packages/kernel/index.js';
import type { RedisService } from '@packages/redis/index.js';
import type { AuditLogService } from '@packages/security/index.js';
import { BaseStorageProvider, S3StorageDriver, type StorageMonitoringService } from '@packages/storage/index.js';
import {
  BACKUP_RECORD_STATUS,
  BACKUP_TARGET_TYPE,
  BACKUP_TRIGGER_SOURCE,
  BACKUP_VERIFY_STATUS,
  RESTORE_OPERATION_TYPE,
  RESTORE_SCOPE,
  RESTORE_STATUS,
} from '@modules/backup-ops/enum/backup-ops.enum.js';
import {
  BackupEncryptionConfigException,
  BackupIntegrityException,
  BackupRestoreGuardException,
  BackupValidationException,
} from '@modules/backup-ops/exceptions/backup-ops.exceptions.js';
import {
  decryptBackupPayload,
  encryptBackupPayload,
} from '@modules/backup-ops/helpers/backup-crypto.helper.js';
import {
  computeNextRunAt,
  isCronDue,
  parseCronExpression,
} from '@modules/backup-ops/helpers/backup-cron.helper.js';
import { buildBackupRunbook } from '@modules/backup-ops/helpers/backup-runbook.helper.js';
import type { BackupPolicyEntity } from '@modules/backup-ops/entities/backup-policy.entity.js';
import type { BackupRecordEntity } from '@modules/backup-ops/entities/backup-record.entity.js';
import type { BackupRestoreHistoryEntity } from '@modules/backup-ops/entities/backup-restore-history.entity.js';
import type { BackupPolicyRepository } from '@modules/backup-ops/repositories/backup-policy.repository.js';
import type { BackupRecordRepository } from '@modules/backup-ops/repositories/backup-record.repository.js';
import type { BackupRestoreHistoryRepository } from '@modules/backup-ops/repositories/backup-restore-history.repository.js';
import { BackupAlertService } from '@modules/backup-ops/services/backup-alert.service.js';
import { BackupOrchestratorService } from '@modules/backup-ops/services/backup-orchestrator.service.js';
import { BackupRestoreDrillService } from '@modules/backup-ops/services/backup-restore-drill.service.js';
import { DatabaseBackupEngineService } from '@modules/backup-ops/services/database-backup-engine.service.js';
import { StorageBackupService } from '@modules/backup-ops/services/storage-backup.service.js';

const TEST_KEY = 'super-secret-backup-encryption-key-2026';

function createFakeConfig(overrides?: {
  restoreExecutionEnabled?: boolean;
  drillDatabase?: string;
}): CoreConfigService {
  return {
    app: { env: 'test' },
    database: {
      connection: 'mysql',
      host: '127.0.0.1',
      port: 3306,
      database: 'core_primary_db',
      username: 'root',
      password: 'primary-secret-password',
    },
    backup: {
      enabled: true,
      storagePrefix: 'backups',
      encryptionEnabled: true,
      encryptionKey: TEST_KEY,
      defaultRetentionDays: 14,
      defaultMaxKeepCount: 30,
      staleMaxAgeHours: 26,
      dbBackupCron: '0 2 * * *',
      storageBackupCron: '30 2 * * 0',
      retentionPruneCron: '0 3 * * *',
      drillEnabled: true,
      drillCron: '0 4 * * *',
      drillDatabase: overrides?.drillDatabase ?? '',
      drillHost: '',
      drillPort: 0,
      drillUsername: '',
      drillPassword: '',
      commandTimeoutMs: 30_000,
      maxStorageSnapshotBytes: 10 * 1024 * 1024,
      restoreExecutionEnabled: overrides?.restoreExecutionEnabled ?? false,
    },
  } as unknown as CoreConfigService;
}

function createInMemoryStorage() {
  const objects = new Map<string, Buffer>();
  const storage = {
    driverName: 'local',
    upload: jest.fn(async (key: string, content: Buffer) => {
      objects.set(key, Buffer.from(content));
      return key;
    }),
    download: jest.fn(async (key: string) => {
      const buf = objects.get(key);
      if (!buf) throw new Error(`Object not found: ${key}`);
      return Buffer.from(buf);
    }),
    delete: jest.fn(async (key: string) => {
      objects.delete(key);
    }),
    getBucketVersioningStatus: jest.fn(async () => ({
      driver: 'local',
      supported: false,
      status: 'unsupported',
      bucket: null,
    })),
    enableBucketVersioning: jest.fn(async () => ({
      driver: 'local',
      supported: false,
      status: 'unsupported',
      bucket: null,
    })),
  } as unknown as BaseStorageProvider;

  const monitoring = {
    provider: {
      scan: jest.fn(async () => ({
        objects: [...objects.entries()].map(([key, buf]) => ({
          key,
          size: buf.length,
          lastModified: Date.now(),
          contentType: 'application/octet-stream',
        })),
        total: objects.size,
        truncated: false,
      })),
    },
  } as unknown as StorageMonitoringService;

  return { objects, storage, monitoring };
}

function createInMemoryRepos() {
  let seq = 1;
  const policies: BackupPolicyEntity[] = [
    {
      id: 1,
      code: 'DAILY_DATABASE_BACKUP',
      name: 'Daily DB Backup',
      targetType: BACKUP_TARGET_TYPE.DATABASE,
      scheduleCron: '0 2 * * *',
      timezone: 'Asia/Ho_Chi_Minh',
      isEnabled: true,
      encryptionEnabled: true,
      compressionEnabled: true,
      retentionDays: 14,
      maxKeepCount: 2,
      autoVerifyDrill: true,
      alertOnFailure: true,
      staleThresholdHours: 26,
      storagePrefix: 'backups',
      optionsJson: null,
      lastRunAt: null,
      lastStatus: null,
      nextRunAt: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    } as BackupPolicyEntity,
  ];
  const records: BackupRecordEntity[] = [];
  const restores: BackupRestoreHistoryEntity[] = [];

  const policyRepo = {
    listAll: jest.fn(async () => [...policies]),
    listEnabled: jest.fn(async () => policies.filter((p) => p.isEnabled)),
    findByIdSafe: jest.fn(async (id: number) => policies.find((p) => p.id === id) ?? null),
    findByCodeSafe: jest.fn(async (code: string) => policies.find((p) => p.code === code) ?? null),
    findFirstEnabledByTarget: jest.fn(
      async (targetType: string) =>
        policies.find((p) => p.isEnabled && p.targetType === targetType) ?? null,
    ),
    saveEntity: jest.fn(async (input: Partial<BackupPolicyEntity>) => {
      if (input.id) {
        const idx = policies.findIndex((p) => p.id === input.id);
        if (idx >= 0) {
          policies[idx] = { ...policies[idx]!, ...input, updatedAt: new Date() } as BackupPolicyEntity;
          return policies[idx]!;
        }
      }
      const created = {
        ...input,
        id: seq++,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as BackupPolicyEntity;
      policies.push(created);
      return created;
    }),
  } as unknown as BackupPolicyRepository;

  const recordRepo = {
    findByIdSafe: jest.fn(async (id: number) => records.find((r) => r.id === id) ?? null),
    findLatestByTarget: jest.fn(async (targetType: string, onlySuccess = false) => {
      const sorted = [...records]
        .filter(
          (r) =>
            r.targetType === targetType && (!onlySuccess || r.status === BACKUP_RECORD_STATUS.SUCCESS),
        )
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || b.id - a.id);
      return sorted[0] ?? null;
    }),
    findLatestForVerifyDrill: jest.fn(async () => {
      const sorted = [...records]
        .filter((r) => r.targetType === 'DATABASE' && r.status === BACKUP_RECORD_STATUS.SUCCESS)
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || b.id - a.id);
      return sorted[0] ?? null;
    }),
    listSuccessfulRecords: jest.fn(async () =>
      [...records]
        .filter((r) => r.status === BACKUP_RECORD_STATUS.SUCCESS)
        .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime() || b.id - a.id),
    ),
    getStatsSnapshot: jest.fn(async () => ({
      totalRecords: records.length,
      successfulRecords: records.filter((r) => r.status === BACKUP_RECORD_STATUS.SUCCESS).length,
      failedRecords24h: records.filter((r) => r.status === BACKUP_RECORD_STATUS.FAILED).length,
      totalStoredBytes: records
        .filter((r) => r.status === BACKUP_RECORD_STATUS.SUCCESS)
        .reduce((acc, r) => acc + (r.storedSizeBytes ?? 0), 0),
      drillTotalCount: records.filter(
        (r) =>
          r.verifyStatus === BACKUP_VERIFY_STATUS.PASSED ||
          r.verifyStatus === BACKUP_VERIFY_STATUS.FAILED,
      ).length,
      drillPassedCount: records.filter((r) => r.verifyStatus === BACKUP_VERIFY_STATUS.PASSED).length,
    })),
    saveEntity: jest.fn(async (input: Partial<BackupRecordEntity>) => {
      if (input.id) {
        const idx = records.findIndex((r) => r.id === input.id);
        if (idx >= 0) {
          records[idx] = { ...records[idx]!, ...input, updatedAt: new Date() } as BackupRecordEntity;
          return records[idx]!;
        }
      }
      const created = {
        ...input,
        id: seq++,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as BackupRecordEntity;
      records.push(created);
      return created;
    }),
  } as unknown as BackupRecordRepository;

  const restoreHistoryRepo = {
    saveEntity: jest.fn(async (input: Partial<BackupRestoreHistoryEntity>) => {
      if (input.id) {
        const idx = restores.findIndex((r) => r.id === input.id);
        if (idx >= 0) {
          restores[idx] = {
            ...restores[idx]!,
            ...input,
            updatedAt: new Date(),
          } as BackupRestoreHistoryEntity;
          return restores[idx]!;
        }
      }
      const created = {
        ...input,
        id: seq++,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      } as BackupRestoreHistoryEntity;
      restores.push(created);
      return created;
    }),
  } as unknown as BackupRestoreHistoryRepository;

  return { policies, records, restores, policyRepo, recordRepo, restoreHistoryRepo };
}

describe('13.6 Backup & Restore Unit Tests', () => {
  it('encrypts with AES-256-GCM + gzip and detects tampering, wrong keys, or checksum mismatch', () => {
    const plain = Buffer.from(
      JSON.stringify({
        format: 'core-logical-db-v1',
        tables: [{ name: 'users', rowCount: 2, rows: [{ id: 1 }, { id: 2 }] }],
      }),
      'utf8',
    );

    const packed = encryptBackupPayload(plain, TEST_KEY, { encrypt: true, compress: true });
    expect(packed.encrypted).toBe(true);
    expect(packed.compressed).toBe(true);
    expect(packed.encryptionAlgorithm).toBe('AES_256_GCM');
    expect(packed.artifact.subarray(0, 8).toString('ascii')).toBe('COREBKP1');
    expect(packed.artifact.includes('users')).toBe(false);

    const decrypted = decryptBackupPayload(
      packed.artifact,
      TEST_KEY,
      packed.artifactSha256,
      packed.plaintextSha256,
    );
    expect(decrypted.equals(plain)).toBe(true);

    // Reject short/empty encryption key
    expect(() =>
      encryptBackupPayload(plain, 'short', { encrypt: true, compress: true }),
    ).toThrow(BackupEncryptionConfigException);

    // Reject wrong key
    expect(() =>
      decryptBackupPayload(packed.artifact, 'wrong-secret-key-at-least-16-chars'),
    ).toThrow(BackupIntegrityException);

    // Reject tampered ciphertext byte
    const tampered = Buffer.from(packed.artifact);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 0xff;
    expect(() => decryptBackupPayload(tampered, TEST_KEY)).toThrow(BackupIntegrityException);

    // Reject artifact SHA-256 mismatch
    expect(() =>
      decryptBackupPayload(packed.artifact, TEST_KEY, '0'.repeat(64)),
    ).toThrow(BackupIntegrityException);
  });

  it('evaluates 5-field cron schedule due state and computes next run time', () => {
    const parsed = parseCronExpression('0 2 * * *');
    expect(parsed).not.toBeNull();
    expect(parseCronExpression('invalid-cron')).toBeNull();

    const twoAm = new Date(2026, 10, 26, 2, 0, 0);
    const twoZeroFive = new Date(2026, 10, 26, 2, 5, 0);
    const yesterdayRun = new Date(2026, 10, 25, 2, 0, 0);

    expect(isCronDue('0 2 * * *', null, twoAm)).toBe(true);
    expect(isCronDue('0 2 * * *', yesterdayRun, twoZeroFive)).toBe(true);
    expect(isCronDue('0 2 * * *', twoAm, twoZeroFive)).toBe(false);

    const next = computeNextRunAt('0 2 * * *', twoZeroFive);
    expect(next).not.toBeNull();
    expect(next!.getHours()).toBe(2);
    expect(next!.getMinutes()).toBe(0);
  });

  it('executes encrypted DB & Storage backups, auto-verifies drill, prunes retention keeping last good backup, and alerts on failure', async () => {
    const cfg = createFakeConfig();
    const { objects, storage, monitoring } = createInMemoryStorage();
    objects.set('uploads/avatar.png', Buffer.from('fake-png-bytes'));
    objects.set('backups/old.cbkp', Buffer.from('must-be-excluded'));

    const repos = createInMemoryRepos();
    const eventBus = new DomainEventBusService();
    const publishedEvents: string[] = [];
    eventBus.registerHandler({
      id: 'test-backup-events-spy',
      module: 'backup-ops',
      eventPattern: '*',
      handler: (ev) => {
        publishedEvents.push(ev.metadata.dotName);
      },
    });

    const ingestAlert = jest.fn(async () => ({ incident: {}, deduplicated: false }));
    const dispatchNotif = jest.fn(async () => ({}));
    const moduleRef = {
      get: jest.fn((token: unknown) => {
        if (String(token).includes('INCIDENTS_OPS')) return { ingestAlert };
        if (String(token).includes('NOTIFICATIONS')) return { dispatch: dispatchNotif };
        throw new Error('Not found');
      }),
    } as never;

    const alertService = new BackupAlertService(moduleRef, cfg, eventBus);
    const auditRecord = jest.fn(async () => ({}));
    const auditLog = { record: auditRecord } as unknown as AuditLogService;

    const logicalDump = Buffer.from(
      JSON.stringify({
        format: 'core-logical-db-v1',
        driver: 'mysql',
        database: 'core_primary_db',
        dumpedAt: new Date().toISOString(),
        tables: [
          { name: 'migrations', rowCount: 3, rows: [] },
          { name: 'users', rowCount: 1, rows: [{ id: 1 }] },
        ],
      }),
      'utf8',
    );

    const dbEngine = new DatabaseBackupEngineService(cfg, {
      driver: 'mysql',
    } as unknown as DatabaseConnectionService);
    jest.spyOn(dbEngine, 'dumpDatabase').mockResolvedValue({
      engine: 'logical-typeorm',
      payload: logicalDump,
      tableCount: 2,
      rowCountEstimate: 1,
    });

    const storageBackup = new StorageBackupService(cfg, storage, monitoring, eventBus);
    const drillService = new BackupRestoreDrillService(
      cfg,
      storage,
      repos.recordRepo,
      repos.restoreHistoryRepo,
      dbEngine,
      storageBackup,
      alertService,
      auditLog,
      eventBus,
    );

    const redisMulti = {
      set: jest.fn().mockReturnThis(),
      lpush: jest.fn().mockReturnThis(),
      ltrim: jest.fn().mockReturnThis(),
      exec: jest.fn(async () => []),
    };
    const redis = {
      isReady: () => true,
      key: (...parts: string[]) => parts.join(':'),
      client: {
        set: jest.fn(async () => 'OK'),
        get: jest.fn(async () => null),
        del: jest.fn(async () => 1),
        multi: jest.fn(() => redisMulti),
      },
    } as unknown as RedisService;

    const orchestrator = new BackupOrchestratorService(
      cfg,
      storage,
      repos.policyRepo,
      repos.recordRepo,
      dbEngine,
      storageBackup,
      drillService,
      alertService,
      redis,
      auditLog,
      eventBus,
    );

    // 1. Run DB backup -> encrypted + stored + auto-drilled + synced to database-ops Redis
    const dbRec = await orchestrator.runBackup({
      targetType: BACKUP_TARGET_TYPE.DATABASE,
      triggerSource: BACKUP_TRIGGER_SOURCE.MANUAL,
      actorName: 'admin',
    });
    expect(dbRec.status).toBe(BACKUP_RECORD_STATUS.SUCCESS);
    expect(dbRec.encrypted).toBe(true);
    expect(dbRec.verifyStatus).toBe(BACKUP_VERIFY_STATUS.PASSED);
    expect(dbRec.storageKey).toMatch(/^backups\/database\//);
    expect(objects.has(dbRec.storageKey!)).toBe(true);
    expect(redisMulti.set).toHaveBeenCalled();
    expect(publishedEvents).toContain(BACKUP_DOMAIN_EVENTS.COMPLETED);
    expect(publishedEvents).toContain(BACKUP_DOMAIN_EVENTS.DRILL_PASSED);

    // 2. Run Storage snapshot -> excludes backups/ prefix & passes verify
    const stgRec = await orchestrator.runBackup({
      targetType: BACKUP_TARGET_TYPE.STORAGE,
      triggerSource: BACKUP_TRIGGER_SOURCE.MANUAL,
      actorName: 'admin',
    });
    expect(stgRec.status).toBe(BACKUP_RECORD_STATUS.SUCCESS);
    expect(stgRec.metadata?.objectCount).toBe(1); // only uploads/avatar.png
    const stgDrill = await orchestrator.verifyBackupRecord(stgRec.id);
    expect(stgDrill.passed).toBe(true);

    // 3. Retention pruning: create 2 extra expired DB records -> keeps newest 1, purges older ones
    const oldDate = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    await orchestrator.runBackup({
      targetType: BACKUP_TARGET_TYPE.DATABASE,
      triggerSource: BACKUP_TRIGGER_SOURCE.MANUAL,
    });
    await orchestrator.runBackup({
      targetType: BACKUP_TARGET_TYPE.DATABASE,
      triggerSource: BACKUP_TRIGGER_SOURCE.MANUAL,
    });
    // Mark oldest 2 DB records as expired
    const dbRecords = repos.records.filter((r) => r.targetType === BACKUP_TARGET_TYPE.DATABASE);
    dbRecords[0]!.expiresAt = oldDate;
    dbRecords[0]!.startedAt = oldDate;
    dbRecords[1]!.expiresAt = oldDate;
    dbRecords[1]!.startedAt = new Date(oldDate.getTime() + 1000);

    const pruneRes = await orchestrator.pruneExpiredBackups();
    expect(pruneRes.purgedCount).toBeGreaterThanOrEqual(2);
    // Latest DB record is never purged
    const remainingSuccessDb = repos.records.filter(
      (r) =>
        r.targetType === BACKUP_TARGET_TYPE.DATABASE &&
        r.status === BACKUP_RECORD_STATUS.SUCCESS,
    );
    expect(remainingSuccessDb.length).toBeGreaterThanOrEqual(1);

    // 4. Alerting on backup failure
    jest.spyOn(dbEngine, 'dumpDatabase').mockRejectedValueOnce(new Error('mysqldump connection lost'));
    await expect(
      orchestrator.runBackup({
        targetType: BACKUP_TARGET_TYPE.DATABASE,
        triggerSource: BACKUP_TRIGGER_SOURCE.SCHEDULED,
      }),
    ).rejects.toThrow('mysqldump connection lost');

    expect(publishedEvents).toContain(BACKUP_DOMAIN_EVENTS.FAILED);
    expect(ingestAlert).toHaveBeenCalled();
    expect(dispatchNotif).toHaveBeenCalled();
  });

  it('enforces primary DB safety guard during drill, requires mandatory reason & audit on restore, and builds runbook', async () => {
    const cfg = createFakeConfig({ drillDatabase: 'core_primary_db' });
    const dbEngine = new DatabaseBackupEngineService(cfg, {
      driver: 'mysql',
    } as unknown as DatabaseConnectionService);

    // Guard must block drilling against the primary database
    await expect(
      dbEngine.restoreToIsolatedDatabase(Buffer.from('SELECT 1;'), 'mysqldump'),
    ).rejects.toThrow(BackupRestoreGuardException);

    const { storage, monitoring } = createInMemoryStorage();
    const repos = createInMemoryRepos();
    const eventBus = new DomainEventBusService();
    const alertService = new BackupAlertService({ get: () => null } as never, cfg, eventBus);
    const auditRecord = jest.fn(async () => ({}));
    const auditLog = { record: auditRecord } as unknown as AuditLogService;
    const storageBackup = new StorageBackupService(cfg, storage, monitoring, eventBus);
    const drillService = new BackupRestoreDrillService(
      cfg,
      storage,
      repos.recordRepo,
      repos.restoreHistoryRepo,
      dbEngine,
      storageBackup,
      alertService,
      auditLog,
      eventBus,
    );

    // Reject missing/short reason
    await expect(
      drillService.executeOrRecordRestore({
        mode: 'RECORD_MANUAL',
        scope: RESTORE_SCOPE.DATABASE,
        targetEnvironment: 'staging',
        actorName: 'alice',
        reason: 'fix',
      }),
    ).rejects.toThrow(BackupValidationException);

    // Reject live restore when disabled
    await expect(
      drillService.executeOrRecordRestore({
        backupRecordId: 999,
        mode: 'EXECUTE_LIVE',
        scope: RESTORE_SCOPE.DATABASE,
        targetEnvironment: 'production',
        actorName: 'alice',
        reason: 'Emergency production recovery',
        confirm: 'WRONG',
      }),
    ).rejects.toThrow();

    // Valid manual restore history record writes both DB history & AuditLog
    const recorded = await drillService.executeOrRecordRestore({
      mode: 'RECORD_MANUAL',
      scope: RESTORE_SCOPE.FULL,
      targetEnvironment: 'staging',
      actorUserId: 7,
      actorName: 'alice@core.local',
      reason: 'DR monthly table-top restore verification for ticket OPS-99',
    });

    expect(recorded.operationType).toBe(RESTORE_OPERATION_TYPE.MANUAL_RESTORE);
    expect(recorded.status).toBe(RESTORE_STATUS.SUCCESS);
    expect(recorded.actorName).toBe('alice@core.local');
    expect(recorded.reason).toContain('OPS-99');
    expect(auditRecord).toHaveBeenCalledTimes(1);

    // Runbook covers all 4 pillars: database, storage, secrets, config
    const runbook = buildBackupRunbook();
    expect(runbook.sections.map((s) => s.id)).toEqual([
      'database',
      'storage',
      'secrets',
      'config',
    ]);
    expect(runbook.postRestoreChecklist.length).toBeGreaterThanOrEqual(4);
  });

  it('supports S3 Bucket Versioning inspection & enablement', async () => {
    const sendMock = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce({ Status: undefined })
      .mockResolvedValueOnce({});

    const fakeS3Client = { send: sendMock } as never;
    const driver = new S3StorageDriver(
      {
        bucket: 'core-uploads',
        region: 'us-east-1',
        endpoint: 'http://minio:9000',
        forcePathStyle: true,
        accessKey: 'minio',
        secretKey: 'miniosecret',
        accessKeySecret: 'S3_ACCESS',
        secretKeySecret: 'S3_SECRET',
        timeoutMs: 5000,
      },
      async () => ({ accessKeyId: 'minio', secretAccessKey: 'miniosecret' }),
      fakeS3Client,
    );

    expect(await driver.getBucketVersioning()).toBe('disabled');
    expect(await driver.setBucketVersioning(true)).toBe('enabled');
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});

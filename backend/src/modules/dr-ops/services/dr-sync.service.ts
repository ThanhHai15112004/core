import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { CoreConfigService } from '@packages/config/index.js';
import { DatabaseRoutingService } from '@packages/database/index.js';
import { DR_DOMAIN_EVENTS, type PaginatedResult } from '@packages/kernel/index.js';
import { AuditLogService } from '@packages/security/index.js';
import { BaseStorageProvider, StorageMonitoringService } from '@packages/storage/index.js';
import {
  BACKUP_OPS_PUBLIC_SERVICE,
  type IBackupOpsPublicService,
} from '@modules/backup-ops/contracts/index.js';
import {
  DR_AUDIT_ACTIONS,
  DR_SYNC_SCOPE,
  DR_SYNC_STATUS,
  DR_SYNC_TRIGGER,
  type DrSyncScope,
  type DrSyncStatus,
  type DrSyncTrigger,
} from '../enum/dr-ops.enum.js';
import { evaluateRpoCompliance } from '../helpers/dr-checklist.helper.js';
import { DrProfileRepository } from '../repositories/dr-profile.repository.js';
import {
  DrSyncRunRepository,
  type ListDrSyncRunsFilter,
} from '../repositories/dr-sync-run.repository.js';
import { DrOpsResponseMapper } from '../responses/dr-ops.response.js';
import type { DrSyncRunView } from '../types/dr-ops.types.js';
import { DrAlertService } from './dr-alert.service.js';
import { DrProfileService } from './dr-profile.service.js';

@Injectable()
export class DrSyncService {
  private readonly logger = new Logger(DrSyncService.name);

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly config: CoreConfigService,
    private readonly profileService: DrProfileService,
    private readonly profileRepo: DrProfileRepository,
    private readonly syncRepo: DrSyncRunRepository,
    private readonly storage: BaseStorageProvider,
    private readonly alertService: DrAlertService,
    @Optional() private readonly dbRouting?: DatabaseRoutingService,
    @Optional() private readonly storageMonitoring?: StorageMonitoringService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  private resolveBackupOps(): IBackupOpsPublicService | null {
    try {
      return this.moduleRef.get<IBackupOpsPublicService>(BACKUP_OPS_PUBLIC_SERVICE, {
        strict: false,
      });
    } catch {
      return null;
    }
  }

  /** Kiểm tra kết nối TCP tới DB Standby tại site DR (nếu được cấu hình). */
  private async probeTcpEndpoint(host: string, port: number, timeoutMs = 2500): Promise<boolean> {
    if (!host || port <= 0) return false;
    return new Promise((resolve) => {
      const socket = net.createConnection({ host, port });
      const done = (ok: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
  }

  /** Đồng bộ delta Storage từ Primary sang thư mục DR local (hoặc prefix DR khi dùng chung driver). */
  private async syncStorageToDr(): Promise<{
    syncedCount: number;
    skippedCount: number;
    failedCount: number;
    syncedBytes: number;
    note: string;
  }> {
    if (!this.storageMonitoring) {
      return {
        syncedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        syncedBytes: 0,
        note: 'StorageMonitoringService unavailable',
      };
    }

    const drStorage = this.config.dr.storage;
    const backupPrefix = this.config.backup.storagePrefix;
    const drPrefix = drStorage.prefix;
    const scanned = await this.storageMonitoring.provider.scan(2000).catch(() => ({
      objects: [],
      total: 0,
      truncated: false,
    }));

    let syncedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let syncedBytes = 0;

    if (drStorage.driver === 'local') {
      const drRoot = path.resolve(drStorage.localPath);
      await fs.mkdir(drRoot, { recursive: true });

      for (const obj of scanned.objects) {
        if (
          obj.key.startsWith(`${backupPrefix}/`) ||
          obj.key.startsWith(`${drPrefix}/`) ||
          obj.key.startsWith('.healthcheck/')
        ) {
          continue;
        }
        const safeRel = obj.key.replace(/^\/+/, '');
        const destPath = path.resolve(drRoot, safeRel);
        if (!destPath.startsWith(`${drRoot}${path.sep}`)) {
          failedCount++;
          continue;
        }

        try {
          const existingStat = await fs.stat(destPath).catch(() => null);
          if (existingStat && existingStat.size === obj.size) {
            skippedCount++;
            continue;
          }
          const buf = await this.storage.download(obj.key);
          await fs.mkdir(path.dirname(destPath), { recursive: true });
          await fs.writeFile(destPath, buf);
          syncedCount++;
          syncedBytes += buf.length;
        } catch {
          failedCount++;
        }
      }

      return {
        syncedCount,
        skippedCount,
        failedCount,
        syncedBytes,
        note: `Local DR replica synced at ${drRoot}`,
      };
    }

    // S3 cross-prefix sync khi dùng S3 driver mà chưa tách worker đồng bộ CRR ngoài
    for (const obj of scanned.objects) {
      if (
        obj.key.startsWith(`${backupPrefix}/`) ||
        obj.key.startsWith(`${drPrefix}/`) ||
        obj.key.startsWith('.healthcheck/')
      ) {
        continue;
      }
      const targetKey = `${drPrefix}/${obj.key.replace(/^\/+/, '')}`;
      try {
        const exists = await this.storage.exists(targetKey);
        if (exists) {
          skippedCount++;
          continue;
        }
        const buf = await this.storage.download(obj.key);
        await this.storage.upload(targetKey, buf);
        syncedCount++;
        syncedBytes += buf.length;
      } catch {
        failedCount++;
      }
    }

    return {
      syncedCount,
      skippedCount,
      failedCount,
      syncedBytes,
      note: `DR prefix "${drPrefix}" synced on ${this.storage.driverName}`,
    };
  }

  /** Thực thi kiểm tra & đồng bộ Database + Storage sang DR, đo actualRpoSeconds và kiểm tra ngưỡng RPO. */
  public async runSync(input?: {
    scope?: DrSyncScope | undefined;
    triggerSource?: DrSyncTrigger | undefined;
    actorUserId?: number | null | undefined;
    actorName?: string | null | undefined;
  }): Promise<DrSyncRunView> {
    const profile = await this.profileService.getOrCreateDefaultProfile();
    const scope = input?.scope ?? DR_SYNC_SCOPE.FULL;
    const triggerSource = input?.triggerSource ?? DR_SYNC_TRIGGER.MANUAL;
    const actorName = input?.actorName?.trim() || 'system-dr-sync';
    const startedAt = new Date();
    const syncCode = `DRS-${startedAt.toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`;

    let dbLagSeconds: number | null = null;
    let dbCheckpoint: string | null = null;
    let dbSourceNote = 'No DR DB or Backup source available';

    if (scope === DR_SYNC_SCOPE.DATABASE || scope === DR_SYNC_SCOPE.FULL) {
      const routingSnap = this.dbRouting?.getSnapshot();
      const drDb = this.config.dr.db;

      if (routingSnap && routingSnap.lagMs !== null && routingSnap.replicaAvailable) {
        dbLagSeconds = Math.max(0, Math.round(routingSnap.lagMs / 1000));
        dbCheckpoint = `replica-lag-${routingSnap.lagMs}ms`;
        dbSourceNote = 'Measured from DatabaseRoutingService replica lag';
      } else if (drDb.host) {
        const port = drDb.port || this.config.database.port;
        const reachable = await this.probeTcpEndpoint(drDb.host, port);
        if (reachable) {
          dbLagSeconds = 0;
          dbCheckpoint = `tcp-ok:${drDb.host}:${port}`;
          dbSourceNote = `Standby DB ${drDb.host}:${port} reachable`;
        } else {
          dbSourceNote = `Standby DB ${drDb.host}:${port} unreachable`;
        }
      } else {
        const backupOps = this.resolveBackupOps();
        const backupOv = backupOps ? await backupOps.getOverview().catch(() => null) : null;
        if (backupOv?.latestDatabaseBackup?.startedAt) {
          const ageMs = Math.max(
            0,
            Date.now() - Date.parse(backupOv.latestDatabaseBackup.startedAt),
          );
          dbLagSeconds = Math.round(ageMs / 1000);
          dbCheckpoint = backupOv.latestDatabaseBackup.backupCode;
          dbSourceNote = 'Estimated RPO from latest Database Backup (13.6)';
        }
      }
    }

    let storageSyncedCount = 0;
    let storageSkippedCount = 0;
    let storageFailedCount = 0;
    let storageSyncedBytes = 0;
    let storageNote = 'Storage sync skipped by scope';

    if (scope === DR_SYNC_SCOPE.STORAGE || scope === DR_SYNC_SCOPE.FULL) {
      const stRes = await this.syncStorageToDr();
      storageSyncedCount = stRes.syncedCount;
      storageSkippedCount = stRes.skippedCount;
      storageFailedCount = stRes.failedCount;
      storageSyncedBytes = stRes.syncedBytes;
      storageNote = stRes.note;
    }

    let actualRpoSeconds: number | null = null;
    if (scope === DR_SYNC_SCOPE.STORAGE) {
      actualRpoSeconds = storageFailedCount === 0 ? 0 : null;
    } else if (dbLagSeconds !== null) {
      actualRpoSeconds = dbLagSeconds;
    }

    const rpoCompliance = evaluateRpoCompliance(actualRpoSeconds, profile.rpoTargetSeconds);
    let status: DrSyncStatus = DR_SYNC_STATUS.SUCCESS;
    if (storageFailedCount > 0 && actualRpoSeconds === null) {
      status = DR_SYNC_STATUS.FAILED;
    } else if (!rpoCompliance.met || storageFailedCount > 0) {
      status = DR_SYNC_STATUS.DEGRADED;
    }

    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());

    const record = await this.syncRepo.saveEntity({
      syncCode,
      profileCode: profile.code,
      scope,
      triggerSource,
      status,
      dbLagSeconds,
      dbCheckpoint,
      storageSyncedCount,
      storageSkippedCount,
      storageFailedCount,
      storageSyncedBytes,
      actualRpoSeconds,
      rpoTargetSeconds: profile.rpoTargetSeconds,
      rpoMet: rpoCompliance.met,
      startedAt,
      completedAt,
      durationMs,
      actorUserId: input?.actorUserId ?? null,
      actorName,
      summaryJson: JSON.stringify({ dbSourceNote, storageNote }),
      errorMessage:
        status === DR_SYNC_STATUS.FAILED ? 'DR storage/database sync encountered errors' : null,
    });

    profile.lastSyncAt = completedAt;
    if (actualRpoSeconds !== null) {
      profile.lastRpoSeconds = actualRpoSeconds;
    }
    if (this.profileRepo.isDatabaseReady()) {
      await this.profileRepo.saveEntity(profile);
    }

    await this.alertService.publishEvent(
      DR_DOMAIN_EVENTS.SYNC_COMPLETED,
      'DrSyncRun',
      record.syncCode,
      {
        syncCode: record.syncCode,
        scope,
        status,
        actualRpoSeconds,
        rpoTargetSeconds: profile.rpoTargetSeconds,
        rpoMet: rpoCompliance.met,
      },
    );

    if (rpoCompliance.status === 'BREACHED') {
      await this.alertService.emitAlert({
        eventName: DR_DOMAIN_EVENTS.SYNC_RPO_BREACHED,
        alertCode: 'DR_RPO_BREACHED',
        title: `Cảnh báo vượt ngưỡng RPO (${actualRpoSeconds}s > ${profile.rpoTargetSeconds}s)`,
        description: `Phiên đồng bộ DR ${record.syncCode} ghi nhận độ trễ thực tế ${actualRpoSeconds}s vượt mục tiêu RPO ${profile.rpoTargetSeconds}s.`,
        severity: 'P1',
        aggregateId: record.syncCode,
        metadata: {
          syncCode: record.syncCode,
          actualRpoSeconds,
          rpoTargetSeconds: profile.rpoTargetSeconds,
        },
      });
    }

    if (this.auditLog) {
      await this.auditLog
        .record({
          module: 'dr-ops',
          feature: 'dr_sync',
          action: DR_AUDIT_ACTIONS.SYNC_EXECUTED,
          resourceType: 'DR_SYNC_RUN',
          resourceId: record.syncCode,
          actorUserId: input?.actorUserId ?? null,
          actorIdentifier: actorName,
          afterData: {
            syncCode: record.syncCode,
            scope,
            status,
            actualRpoSeconds,
            rpoMet: rpoCompliance.met,
          },
        })
        .catch(() => undefined);
    }

    return DrOpsResponseMapper.toSyncRunView(record);
  }

  public async runScheduledSync(): Promise<DrSyncRunView | { skipped: true; reason: string }> {
    const profile = await this.profileService.getOrCreateDefaultProfile();
    if (!this.config.dr.enabled && !profile.isEnabled) {
      this.logger.debug('Skipping scheduled DR sync because DR is disabled');
      return { skipped: true, reason: 'dr_disabled' };
    }
    return this.runSync({
      scope: DR_SYNC_SCOPE.FULL,
      triggerSource: DR_SYNC_TRIGGER.SCHEDULED,
      actorName: 'scheduler-dr-sync',
    });
  }

  public async listSyncRuns(
    filter: ListDrSyncRunsFilter,
  ): Promise<PaginatedResult<DrSyncRunView>> {
    const page = await this.syncRepo.listPaginated(filter);
    return {
      ...page,
      data: page.data.map((item) => DrOpsResponseMapper.toSyncRunView(item)),
    };
  }
}

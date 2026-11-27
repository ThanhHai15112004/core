import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CoreConfigService } from '@packages/config/index.js';
import { DR_DOMAIN_EVENTS, type PaginatedResult } from '@packages/kernel/index.js';
import { AuditLogService } from '@packages/security/index.js';
import { StorageMonitoringService } from '@packages/storage/index.js';
import {
  DR_AUDIT_ACTIONS,
  DR_DISCREPANCY_KIND,
  DR_RECONCILE_STATUS,
  DR_SYNC_SCOPE,
  type DrReconcileStatus,
  type DrSyncScope,
} from '../enum/dr-ops.enum.js';
import { diffDataSnapshots, type SnapshotRecord } from '../helpers/dr-checklist.helper.js';
import {
  DrReconciliationReportRepository,
  type ListDrReconciliationsFilter,
} from '../repositories/dr-reconciliation-report.repository.js';
import { DrSwitchExecutionRepository } from '../repositories/dr-switch-execution.repository.js';
import { DrOpsResponseMapper } from '../responses/dr-ops.response.js';
import type { DrDiscrepancyItem, DrReconciliationReportView } from '../types/dr-ops.types.js';
import { DrAlertService } from './dr-alert.service.js';
import { DrProfileService } from './dr-profile.service.js';

const VALID_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/;

const UNIQUE_KEY_CANDIDATES: Readonly<Record<string, string>> = {
  users: 'email',
  roles: 'code',
  permissions: 'code',
  files: 'storage_key',
  backup_records: 'backup_code',
};

@Injectable()
export class DrReconciliationService {
  constructor(
    private readonly config: CoreConfigService,
    private readonly profileService: DrProfileService,
    private readonly reconcileRepo: DrReconciliationReportRepository,
    private readonly switchRepo: DrSwitchExecutionRepository,
    private readonly alertService: DrAlertService,
    @Optional() private readonly dataSource?: DataSource,
    @Optional() private readonly storageMonitoring?: StorageMonitoringService,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {}

  private async scanLocalDrStorage(rootDir: string): Promise<SnapshotRecord[]> {
    const resolvedRoot = path.resolve(rootDir);
    const items: SnapshotRecord[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          const st = await fs.stat(full).catch(() => null);
          if (st) {
            const rel = path.relative(resolvedRoot, full).split(path.sep).join('/');
            items.push({ key: rel, checksumOrSize: st.size });
          }
        }
      }
    };
    await walk(resolvedRoot);
    return items;
  }

  /** Kiểm tra trùng khóa nghiệp vụ và đếm số bản ghi trên các bảng trọng yếu trong DB. */
  private async inspectDatabaseTables(): Promise<{
    tablesChecked: number;
    duplicateCount: number;
    findings: DrDiscrepancyItem[];
  }> {
    if (!this.dataSource?.isInitialized) {
      return { tablesChecked: 0, duplicateCount: 0, findings: [] };
    }

    const findings: DrDiscrepancyItem[] = [];
    let tablesChecked = 0;
    let duplicateCount = 0;

    for (const rawTable of this.config.dr.reconcileTables) {
      if (!VALID_TABLE_NAME.test(rawTable)) continue;
      try {
        await this.dataSource.query(`SELECT COUNT(*) AS cnt FROM ${rawTable}`);
        tablesChecked++;

        const uniqueCol = UNIQUE_KEY_CANDIDATES[rawTable];
        if (uniqueCol && VALID_TABLE_NAME.test(uniqueCol)) {
          const dupRows = (await this.dataSource.query(
            `SELECT ${uniqueCol} AS dupKey, COUNT(*) AS cnt FROM ${rawTable} WHERE ${uniqueCol} IS NOT NULL GROUP BY ${uniqueCol} HAVING COUNT(*) > 1 LIMIT 20`,
          )) as Array<{ dupKey?: string | number; cnt?: string | number }>;

          for (const row of dupRows) {
            duplicateCount++;
            findings.push({
              area: 'DATABASE',
              target: rawTable,
              key: String(row.dupKey ?? 'unknown'),
              kind: DR_DISCREPANCY_KIND.DUPLICATE_KEY,
              primaryValue: Number(row.cnt ?? 2),
              drValue: null,
              detail: `Duplicate ${uniqueCol} in table ${rawTable} (${row.cnt} rows)`,
            });
          }
        }
      } catch {
        // Bảng chưa tồn tại ở môi trường hiện tại — bỏ qua an toàn
      }
    }

    return { tablesChecked, duplicateCount, findings };
  }

  /** Đối soát dữ liệu Database & Object Storage sau chuyển hệ thống (phát hiện thiếu, trùng, sai lệch). */
  public async runReconciliation(input?: {
    scope?: DrSyncScope | undefined;
    switchExecutionId?: number | null | undefined;
    primaryDbSnapshots?: readonly SnapshotRecord[] | undefined;
    drDbSnapshots?: readonly SnapshotRecord[] | undefined;
    primaryStorageSnapshots?: readonly SnapshotRecord[] | undefined;
    drStorageSnapshots?: readonly SnapshotRecord[] | undefined;
    actorUserId?: number | null | undefined;
    actorName?: string | null | undefined;
  }): Promise<DrReconciliationReportView> {
    const profile = await this.profileService.getOrCreateDefaultProfile();
    const scope = input?.scope ?? DR_SYNC_SCOPE.FULL;
    const actorName = input?.actorName?.trim() || 'system-dr-reconciler';
    const startedAt = new Date();
    const reportCode = `DRC-${startedAt.toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`;

    const findings: DrDiscrepancyItem[] = [];
    let dbTablesChecked = 0;
    let dbMissingCount = 0;
    let dbDuplicateCount = 0;
    let dbMismatchCount = 0;

    let storageObjectsChecked = 0;
    let storageMissingCount = 0;
    let storageDuplicateCount = 0;
    let storageMismatchCount = 0;

    if (scope === DR_SYNC_SCOPE.DATABASE || scope === DR_SYNC_SCOPE.FULL) {
      const dbInspect = await this.inspectDatabaseTables();
      dbTablesChecked = dbInspect.tablesChecked;
      dbDuplicateCount += dbInspect.duplicateCount;
      findings.push(...dbInspect.findings);

      if (input?.primaryDbSnapshots || input?.drDbSnapshots) {
        const dbDiff = diffDataSnapshots({
          area: 'DATABASE',
          target: 'database_snapshots',
          primaryRecords: input.primaryDbSnapshots ?? [],
          drRecords: input.drDbSnapshots ?? [],
        });
        dbTablesChecked = Math.max(
          dbTablesChecked,
          input.primaryDbSnapshots?.length ?? 0,
          input.drDbSnapshots?.length ?? 0,
        );
        dbMissingCount += dbDiff.missingCount;
        dbDuplicateCount += dbDiff.duplicateCount;
        dbMismatchCount += dbDiff.mismatchCount;
        findings.push(...dbDiff.findings);
      }
    }

    if (scope === DR_SYNC_SCOPE.STORAGE || scope === DR_SYNC_SCOPE.FULL) {
      const primaryStorage: SnapshotRecord[] = [...(input?.primaryStorageSnapshots ?? [])];
      let drStorage: SnapshotRecord[] = [...(input?.drStorageSnapshots ?? [])];

      if (primaryStorage.length === 0 && drStorage.length === 0 && this.storageMonitoring) {
        const backupPrefix = this.config.backup.storagePrefix;
        const drPrefix = this.config.dr.storage.prefix;
        const scanned = await this.storageMonitoring.provider.scan(2000).catch(() => ({
          objects: [],
          total: 0,
          truncated: false,
        }));

        for (const obj of scanned.objects) {
          if (obj.key.startsWith(`${backupPrefix}/`) || obj.key.startsWith('.healthcheck/')) {
            continue;
          }
          if (obj.key.startsWith(`${drPrefix}/`)) {
            drStorage.push({
              key: obj.key.slice(drPrefix.length + 1),
              checksumOrSize: obj.size,
            });
          } else {
            primaryStorage.push({ key: obj.key, checksumOrSize: obj.size });
          }
        }

        if (this.config.dr.storage.driver === 'local' && drStorage.length === 0) {
          drStorage = await this.scanLocalDrStorage(this.config.dr.storage.localPath);
        }
      }

      storageObjectsChecked = Math.max(primaryStorage.length, drStorage.length);
      if (primaryStorage.length > 0 || drStorage.length > 0) {
        const stDiff = diffDataSnapshots({
          area: 'STORAGE',
          target: 'object_storage',
          primaryRecords: primaryStorage,
          drRecords: drStorage,
        });
        storageMissingCount += stDiff.missingCount;
        storageDuplicateCount += stDiff.duplicateCount;
        storageMismatchCount += stDiff.mismatchCount;
        findings.push(...stDiff.findings);
      }
    }

    const totalDiscrepancies =
      dbMissingCount +
      dbDuplicateCount +
      dbMismatchCount +
      storageMissingCount +
      storageDuplicateCount +
      storageMismatchCount;

    const status: DrReconcileStatus =
      totalDiscrepancies > 0 ? DR_RECONCILE_STATUS.DISCREPANCIES_FOUND : DR_RECONCILE_STATUS.PASSED;

    const completedAt = new Date();
    const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());

    const saved = await this.reconcileRepo.saveEntity({
      reportCode,
      profileCode: profile.code,
      switchExecutionId: input?.switchExecutionId ?? null,
      scope,
      status,
      dbTablesChecked,
      dbMissingCount,
      dbDuplicateCount,
      dbMismatchCount,
      storageObjectsChecked,
      storageMissingCount,
      storageDuplicateCount,
      storageMismatchCount,
      totalDiscrepancies,
      findingsJson: JSON.stringify(findings.slice(0, 200)),
      actorUserId: input?.actorUserId ?? null,
      actorName,
      startedAt,
      completedAt,
      durationMs,
      errorMessage: null,
    });

    if (input?.switchExecutionId && this.switchRepo.isDatabaseReady()) {
      const sw = await this.switchRepo.findByIdSafe(input.switchExecutionId);
      if (sw) {
        sw.reconciliationReportId = Number(saved.id);
        await this.switchRepo.saveEntity(sw);
      }
    }

    await this.alertService.publishEvent(
      DR_DOMAIN_EVENTS.RECONCILIATION_COMPLETED,
      'DrReconciliationReport',
      saved.reportCode,
      {
        reportCode: saved.reportCode,
        status,
        totalDiscrepancies,
      },
    );

    if (totalDiscrepancies > 0) {
      await this.alertService.emitAlert({
        eventName: DR_DOMAIN_EVENTS.RECONCILIATION_DISCREPANCY_DETECTED,
        alertCode: 'DR_RECONCILE_DISCREPANCY',
        title: `Phát hiện ${totalDiscrepancies} sai lệch dữ liệu sau chuyển site (${saved.reportCode})`,
        description: `Đối soát DR (${scope}) phát hiện thiếu/trùng/lệch: DB=${dbMissingCount + dbDuplicateCount + dbMismatchCount}, Storage=${storageMissingCount + storageDuplicateCount + storageMismatchCount}.`,
        severity: 'P1',
        aggregateId: saved.reportCode,
        metadata: { reportCode: saved.reportCode, totalDiscrepancies },
      });
    }

    if (this.auditLog) {
      await this.auditLog
        .record({
          module: 'dr-ops',
          feature: 'dr_reconciliation',
          action: DR_AUDIT_ACTIONS.RECONCILE_EXECUTED,
          resourceType: 'DR_RECONCILIATION_REPORT',
          resourceId: saved.reportCode,
          actorUserId: input?.actorUserId ?? null,
          actorIdentifier: actorName,
          afterData: { reportCode: saved.reportCode, scope, status, totalDiscrepancies },
        })
        .catch(() => undefined);
    }

    return DrOpsResponseMapper.toReconciliationView(saved);
  }

  public async listReports(
    filter: ListDrReconciliationsFilter,
  ): Promise<PaginatedResult<DrReconciliationReportView>> {
    const page = await this.reconcileRepo.listPaginated(filter);
    return {
      ...page,
      data: page.data.map((item) => DrOpsResponseMapper.toReconciliationView(item)),
    };
  }
}

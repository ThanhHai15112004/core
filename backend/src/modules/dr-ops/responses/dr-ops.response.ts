import { safeJsonParse, safeJsonParseObject } from '@packages/kernel/index.js';
import type { DrDrillEntity } from '../entities/dr-drill.entity.js';
import type { DrProfileEntity } from '../entities/dr-profile.entity.js';
import type { DrReconciliationReportEntity } from '../entities/dr-reconciliation-report.entity.js';
import type { DrSwitchExecutionEntity } from '../entities/dr-switch-execution.entity.js';
import type { DrSyncRunEntity } from '../entities/dr-sync-run.entity.js';
import type {
  DrChecklistItem,
  DrDiscrepancyItem,
  DrDrillView,
  DrProfileView,
  DrReconciliationReportView,
  DrSwitchExecutionView,
  DrSyncRunView,
} from '../types/dr-ops.types.js';

export class DrOpsResponseMapper {
  public static toProfileView(entity: DrProfileEntity): DrProfileView {
    return {
      id: Number(entity.id),
      code: entity.code,
      name: entity.name,
      isEnabled: Boolean(entity.isEnabled),
      topologyMode: entity.topologyMode,
      rpoTargetSeconds: Number(entity.rpoTargetSeconds),
      rtoTargetSeconds: Number(entity.rtoTargetSeconds),
      primarySite: {
        code: entity.primarySiteCode,
        name: entity.primarySiteName,
        region: entity.primaryRegion,
        endpoint: entity.primaryEndpoint ?? null,
      },
      drSite: {
        code: entity.drSiteCode,
        name: entity.drSiteName,
        region: entity.drRegion,
        endpoint: entity.drEndpoint ?? null,
      },
      activeSite: entity.activeSite,
      operationalState: entity.operationalState,
      syncCron: entity.syncCron,
      drillIntervalDays: Number(entity.drillIntervalDays),
      lastSyncAt: entity.lastSyncAt ? new Date(entity.lastSyncAt).toISOString() : null,
      lastRpoSeconds: entity.lastRpoSeconds !== null ? Number(entity.lastRpoSeconds) : null,
      lastDrillAt: entity.lastDrillAt ? new Date(entity.lastDrillAt).toISOString() : null,
      lastRtoSeconds: entity.lastRtoSeconds !== null ? Number(entity.lastRtoSeconds) : null,
      nextDrillDueAt: entity.nextDrillDueAt ? new Date(entity.nextDrillDueAt).toISOString() : null,
      createdAt: new Date(entity.createdAt).toISOString(),
      updatedAt: new Date(entity.updatedAt).toISOString(),
    };
  }

  public static toSyncRunView(entity: DrSyncRunEntity): DrSyncRunView {
    return {
      id: Number(entity.id),
      syncCode: entity.syncCode,
      profileCode: entity.profileCode,
      scope: entity.scope,
      triggerSource: entity.triggerSource,
      status: entity.status,
      dbLagSeconds: entity.dbLagSeconds !== null ? Number(entity.dbLagSeconds) : null,
      dbCheckpoint: entity.dbCheckpoint ?? null,
      storageSyncedCount: Number(entity.storageSyncedCount),
      storageSkippedCount: Number(entity.storageSkippedCount),
      storageFailedCount: Number(entity.storageFailedCount),
      storageSyncedBytes: Number(entity.storageSyncedBytes),
      actualRpoSeconds: entity.actualRpoSeconds !== null ? Number(entity.actualRpoSeconds) : null,
      rpoTargetSeconds: Number(entity.rpoTargetSeconds),
      rpoMet: Boolean(entity.rpoMet),
      startedAt: new Date(entity.startedAt).toISOString(),
      completedAt: entity.completedAt ? new Date(entity.completedAt).toISOString() : null,
      durationMs: entity.durationMs !== null ? Number(entity.durationMs) : null,
      actorName: entity.actorName ?? null,
      summary: entity.summaryJson ? safeJsonParseObject(entity.summaryJson) : null,
      errorMessage: entity.errorMessage ?? null,
    };
  }

  public static toSwitchExecutionView(entity: DrSwitchExecutionEntity): DrSwitchExecutionView {
    return {
      id: Number(entity.id),
      switchCode: entity.switchCode,
      profileCode: entity.profileCode,
      direction: entity.direction,
      mode: entity.mode,
      fromSite: entity.fromSite,
      toSite: entity.toSite,
      status: entity.status,
      reason: entity.reason,
      checklist: safeJsonParse<DrChecklistItem[]>(entity.checklistJson, []) ?? [],
      rtoTargetSeconds: Number(entity.rtoTargetSeconds),
      actualRtoSeconds: entity.actualRtoSeconds !== null ? Number(entity.actualRtoSeconds) : null,
      rtoMet: entity.rtoMet !== null ? Boolean(entity.rtoMet) : null,
      reconciliationReportId:
        entity.reconciliationReportId !== null ? Number(entity.reconciliationReportId) : null,
      initiatedByName: entity.initiatedByName,
      completedByName: entity.completedByName ?? null,
      startedAt: new Date(entity.startedAt).toISOString(),
      completedAt: entity.completedAt ? new Date(entity.completedAt).toISOString() : null,
      durationMs: entity.durationMs !== null ? Number(entity.durationMs) : null,
      errorMessage: entity.errorMessage ?? null,
    };
  }

  public static toReconciliationView(
    entity: DrReconciliationReportEntity,
  ): DrReconciliationReportView {
    return {
      id: Number(entity.id),
      reportCode: entity.reportCode,
      profileCode: entity.profileCode,
      switchExecutionId:
        entity.switchExecutionId !== null ? Number(entity.switchExecutionId) : null,
      scope: entity.scope,
      status: entity.status,
      dbTablesChecked: Number(entity.dbTablesChecked),
      dbMissingCount: Number(entity.dbMissingCount),
      dbDuplicateCount: Number(entity.dbDuplicateCount),
      dbMismatchCount: Number(entity.dbMismatchCount),
      storageObjectsChecked: Number(entity.storageObjectsChecked),
      storageMissingCount: Number(entity.storageMissingCount),
      storageDuplicateCount: Number(entity.storageDuplicateCount),
      storageMismatchCount: Number(entity.storageMismatchCount),
      totalDiscrepancies: Number(entity.totalDiscrepancies),
      findings: entity.findingsJson
        ? (safeJsonParse<DrDiscrepancyItem[]>(entity.findingsJson, []) ?? [])
        : [],
      actorName: entity.actorName,
      startedAt: new Date(entity.startedAt).toISOString(),
      completedAt: entity.completedAt ? new Date(entity.completedAt).toISOString() : null,
      durationMs: entity.durationMs !== null ? Number(entity.durationMs) : null,
      errorMessage: entity.errorMessage ?? null,
    };
  }

  public static toDrillView(entity: DrDrillEntity): DrDrillView {
    return {
      id: Number(entity.id),
      drillCode: entity.drillCode,
      profileCode: entity.profileCode,
      drillType: entity.drillType,
      scenario: entity.scenario,
      status: entity.status,
      rpoTargetSeconds: Number(entity.rpoTargetSeconds),
      rtoTargetSeconds: Number(entity.rtoTargetSeconds),
      measuredRpoSeconds:
        entity.measuredRpoSeconds !== null ? Number(entity.measuredRpoSeconds) : null,
      measuredRtoSeconds:
        entity.measuredRtoSeconds !== null ? Number(entity.measuredRtoSeconds) : null,
      rpoMet: Boolean(entity.rpoMet),
      rtoMet: Boolean(entity.rtoMet),
      switchExecutionId:
        entity.switchExecutionId !== null ? Number(entity.switchExecutionId) : null,
      reconciliationReportId:
        entity.reconciliationReportId !== null ? Number(entity.reconciliationReportId) : null,
      steps: entity.stepsJson
        ? (safeJsonParse<
            Array<{ name: string; status: string; durationMs: number; detail?: string }>
          >(entity.stepsJson, []) ?? [])
        : [],
      lessonsLearned: entity.lessonsLearned ?? null,
      actorName: entity.actorName,
      startedAt: new Date(entity.startedAt).toISOString(),
      completedAt: entity.completedAt ? new Date(entity.completedAt).toISOString() : null,
      durationMs: entity.durationMs !== null ? Number(entity.durationMs) : null,
      errorMessage: entity.errorMessage ?? null,
    };
  }
}

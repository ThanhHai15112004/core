import {
  safeJsonParse,
  safeJsonParseObject,
  safeJsonParseStringArray,
  type DataRepairFieldDiff,
  type DataRepairPreviewOutcome,
  type ReconciliationMatchingRules,
} from '@packages/kernel/index.js';
import type { DataRepairExecutionEntity } from '../entities/data-repair-execution.entity.js';
import type { DataRepairRequestEntity } from '../entities/data-repair-request.entity.js';
import type { ReconciliationDiscrepancyEntity } from '../entities/reconciliation-discrepancy.entity.js';
import type { ReconciliationJobEntity } from '../entities/reconciliation-job.entity.js';
import type { ReconciliationRunEntity } from '../entities/reconciliation-run.entity.js';
import {
  getDataRepairStatusName,
  getReconciliationDiscrepancyStatusName,
  getReconciliationDiscrepancyTypeName,
  getReconciliationRunStatusName,
  getReconciliationSeverityName,
} from '../enum/reconciliation.enum.js';
import type {
  DataRepairExecutionView,
  DataRepairRequestView,
  ReconciliationDiscrepancyView,
  ReconciliationJobView,
  ReconciliationRunView,
} from '../types/reconciliation.types.js';

function toIsoOrNull(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  const d = val instanceof Date ? val : new Date(val);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toIso(val: Date | string | null | undefined): string {
  return toIsoOrNull(val) ?? new Date().toISOString();
}

export class ReconciliationResponseMapper {
  public static toJobView(entity: ReconciliationJobEntity): ReconciliationJobView {
    return {
      id: Number(entity.id),
      jobCode: entity.jobCode,
      name: entity.name,
      description: entity.description ?? null,
      adapterCode: entity.adapterCode,
      targetModule: entity.targetModule,
      scheduleCron: entity.scheduleCron ?? null,
      isEnabled: Boolean(entity.isEnabled),
      defaultAssigneeUserId: entity.defaultAssigneeUserId ?? null,
      matchingRules: (safeJsonParseObject<Record<string, unknown>>(entity.matchingRulesJson, {}) ??
        {}) as unknown as ReconciliationMatchingRules,
      config: safeJsonParseObject<Record<string, unknown>>(entity.configJson, {}) ?? {},
      lastRunId: entity.lastRunId ?? null,
      lastRunAt: toIsoOrNull(entity.lastRunAt),
      nextRunAt: toIsoOrNull(entity.nextRunAt),
      createdBy: entity.createdBy ?? null,
      updatedBy: entity.updatedBy ?? null,
      createdAt: toIso(entity.createdAt),
      updatedAt: toIso(entity.updatedAt),
    };
  }

  public static toRunView(entity: ReconciliationRunEntity): ReconciliationRunView {
    return {
      id: Number(entity.id),
      runCode: entity.runCode,
      jobId: Number(entity.jobId),
      jobCode: entity.jobCode,
      adapterCode: entity.adapterCode,
      targetModule: entity.targetModule,
      triggerMode: entity.triggerMode,
      status: entity.status,
      statusName: getReconciliationRunStatusName(entity.status),
      periodStart: toIso(entity.periodStart),
      periodEnd: toIso(entity.periodEnd),
      totalInternalCount: Number(entity.totalInternalCount ?? 0),
      totalExternalCount: Number(entity.totalExternalCount ?? 0),
      matchedCount: Number(entity.matchedCount ?? 0),
      discrepancyCount: Number(entity.discrepancyCount ?? 0),
      missingInternalCount: Number(entity.missingInternalCount ?? 0),
      missingExternalCount: Number(entity.missingExternalCount ?? 0),
      duplicateCount: Number(entity.duplicateCount ?? 0),
      statusMismatchCount: Number(entity.statusMismatchCount ?? 0),
      amountMismatchCount: Number(entity.amountMismatchCount ?? 0),
      dataMismatchCount: Number(entity.dataMismatchCount ?? 0),
      internalTotalAmount: Number(entity.internalTotalAmount ?? 0),
      externalTotalAmount: Number(entity.externalTotalAmount ?? 0),
      amountDiffTotal: Number(entity.amountDiffTotal ?? 0),
      currency: entity.currency ?? null,
      correlationId: entity.correlationId ?? null,
      summary: safeJsonParseObject<Record<string, unknown>>(entity.summaryJson, {}) ?? {},
      errorMessage: entity.errorMessage ?? null,
      triggeredBy: entity.triggeredBy ?? null,
      startedAt: toIso(entity.startedAt),
      completedAt: toIsoOrNull(entity.completedAt),
      createdAt: toIso(entity.createdAt),
    };
  }

  public static toDiscrepancyView(
    entity: ReconciliationDiscrepancyEntity,
  ): ReconciliationDiscrepancyView {
    return {
      id: Number(entity.id),
      discrepancyCode: entity.discrepancyCode,
      runId: Number(entity.runId),
      jobId: Number(entity.jobId),
      targetModule: entity.targetModule,
      entityType: entity.entityType ?? null,
      entityId: entity.entityId ?? null,
      recordKey: entity.recordKey,
      discrepancyType: entity.discrepancyType,
      discrepancyTypeName: getReconciliationDiscrepancyTypeName(entity.discrepancyType),
      severity: entity.severity,
      severityName: getReconciliationSeverityName(entity.severity),
      status: entity.status,
      statusName: getReconciliationDiscrepancyStatusName(entity.status),
      assigneeUserId: entity.assigneeUserId ?? null,
      internalStatus: entity.internalStatus ?? null,
      externalStatus: entity.externalStatus ?? null,
      internalAmount: entity.internalAmount ?? null,
      externalAmount: entity.externalAmount ?? null,
      amountDiff: entity.amountDiff ?? null,
      currency: entity.currency ?? null,
      internalSnapshot: entity.internalSnapshotJson
        ? safeJsonParseObject<Record<string, unknown>>(entity.internalSnapshotJson)
        : null,
      externalSnapshot: entity.externalSnapshotJson
        ? safeJsonParseObject<Record<string, unknown>>(entity.externalSnapshotJson)
        : null,
      diffFields: safeJsonParseObject<Record<string, unknown>>(entity.diffFieldsJson, {}) ?? {},
      resolutionNote: entity.resolutionNote ?? null,
      resolvedBy: entity.resolvedBy ?? null,
      resolvedAt: toIsoOrNull(entity.resolvedAt),
      createdAt: toIso(entity.createdAt),
      updatedAt: toIso(entity.updatedAt),
    };
  }

  public static toRepairExecutionView(entity: DataRepairExecutionEntity): DataRepairExecutionView {
    return {
      id: Number(entity.id),
      repairRequestId: Number(entity.repairRequestId),
      repairCode: entity.repairCode,
      executionMode: entity.executionMode,
      executionStatus: entity.executionStatus,
      affectedCount: Number(entity.affectedCount ?? 0),
      actorUserId: entity.actorUserId ?? null,
      summary: entity.summary ?? null,
      beforeData: entity.beforeDataJson
        ? safeJsonParseObject<Record<string, unknown>>(entity.beforeDataJson)
        : null,
      afterData: entity.afterDataJson
        ? safeJsonParseObject<Record<string, unknown>>(entity.afterDataJson)
        : null,
      diff: safeJsonParse<DataRepairFieldDiff[]>(entity.diffJson, []) ?? [],
      errorMessage: entity.errorMessage ?? null,
      durationMs: Number(entity.durationMs ?? 0),
      executedAt: toIso(entity.executedAt),
    };
  }

  public static toRepairRequestView(
    entity: DataRepairRequestEntity,
    executions?: readonly DataRepairExecutionEntity[],
  ): DataRepairRequestView {
    return {
      id: Number(entity.id),
      repairCode: entity.repairCode,
      discrepancyId: entity.discrepancyId ?? null,
      parentRepairId: entity.parentRepairId ?? null,
      actionMode: entity.actionMode,
      handlerCode: entity.handlerCode,
      targetModule: entity.targetModule,
      targetEntityType: entity.targetEntityType,
      targetEntityId: entity.targetEntityId,
      isSensitive: Boolean(entity.isSensitive),
      sensitivityReasons: safeJsonParseStringArray(entity.sensitivityReasonsJson),
      canRollback: Boolean(entity.canRollback),
      status: entity.status,
      statusName: getDataRepairStatusName(entity.status),
      reason: entity.reason,
      payload: safeJsonParseObject<Record<string, unknown>>(entity.payloadJson, {}) ?? {},
      dryRunPreview: entity.dryRunPreviewJson
        ? (safeJsonParseObject<Record<string, unknown>>(
            entity.dryRunPreviewJson,
          ) as unknown as DataRepairPreviewOutcome)
        : null,
      beforeSnapshot: entity.beforeSnapshotJson
        ? safeJsonParseObject<Record<string, unknown>>(entity.beforeSnapshotJson)
        : null,
      afterSnapshot: entity.afterSnapshotJson
        ? safeJsonParseObject<Record<string, unknown>>(entity.afterSnapshotJson)
        : null,
      fieldDiffs: safeJsonParse<DataRepairFieldDiff[]>(entity.fieldDiffsJson, []) ?? [],
      compensationType: entity.compensationType ?? null,
      compensationDetails: entity.compensationDetailsJson
        ? safeJsonParseObject<Record<string, unknown>>(entity.compensationDetailsJson)
        : null,
      requestedBy: entity.requestedBy ?? null,
      approvedBy: entity.approvedBy ?? null,
      approvedAt: toIsoOrNull(entity.approvedAt),
      rejectedBy: entity.rejectedBy ?? null,
      rejectedAt: toIsoOrNull(entity.rejectedAt),
      approvalNote: entity.approvalNote ?? null,
      executedBy: entity.executedBy ?? null,
      executedAt: toIsoOrNull(entity.executedAt),
      errorMessage: entity.errorMessage ?? null,
      createdAt: toIso(entity.createdAt),
      updatedAt: toIso(entity.updatedAt),
      ...(executions ? { executions: executions.map((e) => this.toRepairExecutionView(e)) } : {}),
    };
  }
}

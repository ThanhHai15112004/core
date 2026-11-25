import type {
  DataRepairFieldDiff,
  DataRepairPreviewOutcome,
  ReconciliationComparableRecord,
  ReconciliationMatchingRules,
} from '@packages/kernel/index.js';
import type {
  DataRepairActionMode,
  DataRepairExecutionMode,
  DataRepairExecutionStatus,
  DataRepairStatusCode,
  DataRepairStatusName,
  ReconciliationDiscrepancyStatusCode,
  ReconciliationDiscrepancyStatusName,
  ReconciliationDiscrepancyTypeCode,
  ReconciliationDiscrepancyTypeName,
  ReconciliationRunStatusCode,
  ReconciliationRunStatusName,
  ReconciliationSeverityCode,
  ReconciliationSeverityName,
  ReconciliationTriggerMode,
} from '../enum/reconciliation.enum.js';

export interface ReconciliationRuntimeConfig {
  readonly highAmountDiffThreshold: number;
  readonly criticalAmountDiffThreshold: number;
  readonly sensitiveAmountThreshold: number;
  readonly requireDryRunBeforeApply: boolean;
  readonly requireApprovalForAllRepairs: boolean;
  readonly maxRecordsPerRun: number;
  readonly retentionDays: number;
}

export interface ReconciliationJobView {
  readonly id: number;
  readonly jobCode: string;
  readonly name: string;
  readonly description: string | null;
  readonly adapterCode: string;
  readonly targetModule: string;
  readonly scheduleCron: string | null;
  readonly isEnabled: boolean;
  readonly defaultAssigneeUserId: number | null;
  readonly matchingRules: ReconciliationMatchingRules;
  readonly config: Record<string, unknown>;
  readonly lastRunId: number | null;
  readonly lastRunAt: string | null;
  readonly nextRunAt: string | null;
  readonly createdBy: number | null;
  readonly updatedBy: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReconciliationRunView {
  readonly id: number;
  readonly runCode: string;
  readonly jobId: number;
  readonly jobCode: string;
  readonly adapterCode: string;
  readonly targetModule: string;
  readonly triggerMode: ReconciliationTriggerMode;
  readonly status: ReconciliationRunStatusCode;
  readonly statusName: ReconciliationRunStatusName;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly totalInternalCount: number;
  readonly totalExternalCount: number;
  readonly matchedCount: number;
  readonly discrepancyCount: number;
  readonly missingInternalCount: number;
  readonly missingExternalCount: number;
  readonly duplicateCount: number;
  readonly statusMismatchCount: number;
  readonly amountMismatchCount: number;
  readonly dataMismatchCount: number;
  readonly internalTotalAmount: number;
  readonly externalTotalAmount: number;
  readonly amountDiffTotal: number;
  readonly currency: string | null;
  readonly correlationId: string | null;
  readonly summary: Record<string, unknown>;
  readonly errorMessage: string | null;
  readonly triggeredBy: number | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly createdAt: string;
}

export interface ReconciliationDiscrepancyView {
  readonly id: number;
  readonly discrepancyCode: string;
  readonly runId: number;
  readonly jobId: number;
  readonly targetModule: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly recordKey: string;
  readonly discrepancyType: ReconciliationDiscrepancyTypeCode;
  readonly discrepancyTypeName: ReconciliationDiscrepancyTypeName;
  readonly severity: ReconciliationSeverityCode;
  readonly severityName: ReconciliationSeverityName;
  readonly status: ReconciliationDiscrepancyStatusCode;
  readonly statusName: ReconciliationDiscrepancyStatusName;
  readonly assigneeUserId: number | null;
  readonly internalStatus: string | null;
  readonly externalStatus: string | null;
  readonly internalAmount: number | null;
  readonly externalAmount: number | null;
  readonly amountDiff: number | null;
  readonly currency: string | null;
  readonly internalSnapshot: Record<string, unknown> | null;
  readonly externalSnapshot: Record<string, unknown> | null;
  readonly diffFields: Record<string, unknown>;
  readonly resolutionNote: string | null;
  readonly resolvedBy: number | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReconciliationDiscrepancyReportView {
  readonly totalDiscrepancies: number;
  readonly openCount: number;
  readonly assignedCount: number;
  readonly inRepairCount: number;
  readonly resolvedCount: number;
  readonly compensatedCount: number;
  readonly ignoredCount: number;
  readonly totalAbsAmountDiff: number;
  readonly byType: Record<ReconciliationDiscrepancyTypeName, number>;
  readonly bySeverity: Record<ReconciliationSeverityName, number>;
  readonly byAssignee: ReadonlyArray<{
    readonly assigneeUserId: number | null;
    readonly total: number;
    readonly openOrAssigned: number;
    readonly highOrCritical: number;
  }>;
  readonly generatedAt: string;
}

export interface DataRepairExecutionView {
  readonly id: number;
  readonly repairRequestId: number;
  readonly repairCode: string;
  readonly executionMode: DataRepairExecutionMode;
  readonly executionStatus: DataRepairExecutionStatus;
  readonly affectedCount: number;
  readonly actorUserId: number | null;
  readonly summary: string | null;
  readonly beforeData: Record<string, unknown> | null;
  readonly afterData: Record<string, unknown> | null;
  readonly diff: readonly DataRepairFieldDiff[];
  readonly errorMessage: string | null;
  readonly durationMs: number;
  readonly executedAt: string;
}

export interface DataRepairRequestView {
  readonly id: number;
  readonly repairCode: string;
  readonly discrepancyId: number | null;
  readonly parentRepairId: number | null;
  readonly actionMode: DataRepairActionMode;
  readonly handlerCode: string;
  readonly targetModule: string;
  readonly targetEntityType: string;
  readonly targetEntityId: string;
  readonly isSensitive: boolean;
  readonly sensitivityReasons: readonly string[];
  readonly canRollback: boolean;
  readonly status: DataRepairStatusCode;
  readonly statusName: DataRepairStatusName;
  readonly reason: string;
  readonly payload: Record<string, unknown>;
  readonly dryRunPreview: DataRepairPreviewOutcome | null;
  readonly beforeSnapshot: Record<string, unknown> | null;
  readonly afterSnapshot: Record<string, unknown> | null;
  readonly fieldDiffs: readonly DataRepairFieldDiff[];
  readonly compensationType: string | null;
  readonly compensationDetails: Record<string, unknown> | null;
  readonly requestedBy: number | null;
  readonly approvedBy: number | null;
  readonly approvedAt: string | null;
  readonly rejectedBy: number | null;
  readonly rejectedAt: string | null;
  readonly approvalNote: string | null;
  readonly executedBy: number | null;
  readonly executedAt: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly executions?: readonly DataRepairExecutionView[] | undefined;
}

export interface CreateReconciliationJobInput {
  readonly jobCode?: string | undefined;
  readonly name: string;
  readonly description?: string | null | undefined;
  readonly adapterCode: string;
  readonly targetModule?: string | undefined;
  readonly scheduleCron?: string | null | undefined;
  readonly isEnabled?: boolean | undefined;
  readonly defaultAssigneeUserId?: number | null | undefined;
  readonly matchingRules?: ReconciliationMatchingRules | undefined;
  readonly config?: Readonly<Record<string, unknown>> | undefined;
}

export interface UpdateReconciliationJobInput {
  readonly name?: string | undefined;
  readonly description?: string | null | undefined;
  readonly scheduleCron?: string | null | undefined;
  readonly isEnabled?: boolean | undefined;
  readonly defaultAssigneeUserId?: number | null | undefined;
  readonly matchingRules?: ReconciliationMatchingRules | undefined;
  readonly config?: Readonly<Record<string, unknown>> | undefined;
}

export interface TriggerReconciliationRunInput {
  readonly periodStart?: string | Date | undefined;
  readonly periodEnd?: string | Date | undefined;
  readonly async?: boolean | undefined;
  readonly reason?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly internalRecords?: readonly ReconciliationComparableRecord[] | undefined;
  readonly externalRecords?: readonly ReconciliationComparableRecord[] | undefined;
  readonly internalCsv?: string | undefined;
  readonly externalCsv?: string | undefined;
  readonly parameters?: Readonly<Record<string, unknown>> | undefined;
}

export interface QueuedReconciliationRunJobPayload {
  readonly runId: number;
  readonly jobId: number;
  readonly triggeredBy?: number | null | undefined;
  readonly reason?: string | undefined;
  readonly internalRecords?: readonly ReconciliationComparableRecord[] | undefined;
  readonly externalRecords?: readonly ReconciliationComparableRecord[] | undefined;
  readonly internalCsv?: string | undefined;
  readonly externalCsv?: string | undefined;
  readonly parameters?: Readonly<Record<string, unknown>> | undefined;
}

export interface PreviewDataRepairInput {
  readonly discrepancyId?: number | null | undefined;
  readonly parentRepairId?: number | null | undefined;
  readonly actionMode?: DataRepairActionMode | undefined;
  readonly handlerCode: string;
  readonly targetModule?: string | undefined;
  readonly targetEntityType?: string | undefined;
  readonly targetEntityId?: string | undefined;
  readonly compensationType?: string | undefined;
  readonly payload?: Readonly<Record<string, unknown>> | undefined;
  readonly reason: string;
}

export interface ProposeDataRepairInput extends PreviewDataRepairInput {
  readonly forceSensitive?: boolean | undefined;
}

export interface DecideDataRepairInput {
  readonly note?: string | undefined;
}

export interface CreateCompensationInput {
  readonly handlerCode?: string | undefined;
  readonly compensationType: string;
  readonly payload?: Readonly<Record<string, unknown>> | undefined;
  readonly reason: string;
}

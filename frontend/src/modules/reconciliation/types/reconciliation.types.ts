export type ReconciliationTriggerMode = 'SCHEDULED' | 'MANUAL';
export type DataRepairActionMode = 'DIRECT_REPAIR' | 'COMPENSATING_ACTION';

export interface ReconciliationAdapterMetadata {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly targetModule: string;
  readonly supportsExternalUpload: boolean;
}

export interface DataRepairHandlerMetadata {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly targetModule: string;
  readonly supportedModes: readonly DataRepairActionMode[];
  readonly alwaysSensitive: boolean;
  readonly supportsRollback: boolean;
}

export interface ReconciliationCatalog {
  readonly adapters: readonly ReconciliationAdapterMetadata[];
  readonly repairHandlers: readonly DataRepairHandlerMetadata[];
}

export interface ReconciliationJobItem {
  readonly id: number;
  readonly jobCode: string;
  readonly name: string;
  readonly description: string | null;
  readonly adapterCode: string;
  readonly targetModule: string;
  readonly scheduleCron: string | null;
  readonly isEnabled: boolean;
  readonly defaultAssigneeUserId: number | null;
  readonly lastRunId: number | null;
  readonly lastRunAt: string | null;
  readonly nextRunAt: string | null;
  readonly createdAt: string;
}

export interface ReconciliationRunItem {
  readonly id: number;
  readonly runCode: string;
  readonly jobId: number;
  readonly jobCode: string;
  readonly adapterCode: string;
  readonly targetModule: string;
  readonly triggerMode: ReconciliationTriggerMode;
  readonly status: number;
  readonly statusName: string;
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
  readonly triggeredBy: number | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly errorMessage: string | null;
}

export interface ReconciliationDiscrepancyItem {
  readonly id: number;
  readonly discrepancyCode: string;
  readonly runId: number;
  readonly jobId: number;
  readonly targetModule: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly recordKey: string;
  readonly discrepancyType: number;
  readonly discrepancyTypeName: string;
  readonly severity: number;
  readonly severityName: string;
  readonly status: number;
  readonly statusName: string;
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
  readonly createdAt: string;
}

export interface ReconciliationDiscrepancyReport {
  readonly totalDiscrepancies: number;
  readonly openCount: number;
  readonly assignedCount: number;
  readonly inRepairCount: number;
  readonly resolvedCount: number;
  readonly compensatedCount: number;
  readonly ignoredCount: number;
  readonly totalAbsAmountDiff: number;
  readonly byType: Record<string, number>;
  readonly bySeverity: Record<string, number>;
  readonly byAssignee: ReadonlyArray<{
    readonly assigneeUserId: number | null;
    readonly total: number;
    readonly openOrAssigned: number;
    readonly highOrCritical: number;
  }>;
  readonly generatedAt: string;
}

export interface DataRepairFieldDiff {
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface DataRepairPreviewOutcome {
  readonly affectedCount: number;
  readonly summary: string;
  readonly beforeSnapshot: Record<string, unknown>;
  readonly predictedAfterSnapshot: Record<string, unknown>;
  readonly fieldDiffs: readonly DataRepairFieldDiff[];
  readonly isSensitive: boolean;
  readonly sensitivityReasons: readonly string[];
  readonly canRollback: boolean;
  readonly warnings?: readonly string[];
}

export interface DataRepairExecutionItem {
  readonly id: number;
  readonly repairRequestId: number;
  readonly repairCode: string;
  readonly executionMode: 'DRY_RUN' | 'APPLY' | 'COMPENSATE';
  readonly executionStatus: 'SUCCEEDED' | 'FAILED';
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

export interface DataRepairRequestItem {
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
  readonly status: number;
  readonly statusName: string;
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
  readonly executions?: readonly DataRepairExecutionItem[];
}

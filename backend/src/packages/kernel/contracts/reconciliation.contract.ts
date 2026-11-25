/**
 * Hợp đồng chuẩn cho Đối soát và Sửa dữ liệu (Phase 11.5).
 * Đặt tại `@packages/kernel` để mọi module nghiệp vụ có thể đăng ký Source Adapter đối soát
 * và Data Repair / Compensation Handler mà không tạo phụ thuộc vòng với `ReconciliationModule`.
 */

export const RECONCILIATION_PORT = Symbol('RECONCILIATION_PORT');

export const RECONCILIATION_QUEUE_TOPICS = {
  RUN_JOB: 'reconciliation.run',
  SCHEDULE_TICK: 'reconciliation.schedule.tick',
} as const;

export type ReconciliationQueueTopic =
  (typeof RECONCILIATION_QUEUE_TOPICS)[keyof typeof RECONCILIATION_QUEUE_TOPICS];

export const RECONCILIATION_TRIGGER_MODE = {
  SCHEDULED: 'SCHEDULED',
  MANUAL: 'MANUAL',
} as const;

export type ReconciliationTriggerMode =
  (typeof RECONCILIATION_TRIGGER_MODE)[keyof typeof RECONCILIATION_TRIGGER_MODE];

export const RECONCILIATION_RUN_STATUS = {
  QUEUED: 1,
  RUNNING: 2,
  COMPLETED: 3,
  FAILED: 4,
} as const;

export type ReconciliationRunStatusCode =
  (typeof RECONCILIATION_RUN_STATUS)[keyof typeof RECONCILIATION_RUN_STATUS];

export type ReconciliationRunStatusName = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';

export const RECONCILIATION_DISCREPANCY_TYPE = {
  /** Có ở nguồn bên ngoài nhưng thiếu trong dữ liệu nội bộ */
  MISSING_INTERNAL: 1,
  /** Có trong dữ liệu nội bộ nhưng thiếu ở nguồn bên ngoài */
  MISSING_EXTERNAL: 2,
  /** Trùng lặp bản ghi trong dữ liệu nội bộ cùng khóa đối soát */
  DUPLICATE_INTERNAL: 3,
  /** Trùng lặp bản ghi ở nguồn bên ngoài cùng khóa đối soát */
  DUPLICATE_EXTERNAL: 4,
  /** Khớp khóa nhưng sai trạng thái */
  STATUS_MISMATCH: 5,
  /** Khớp khóa nhưng sai số tiền hoặc đơn vị tiền tệ */
  AMOUNT_MISMATCH: 6,
  /** Khớp khóa nhưng sai trường dữ liệu khác */
  DATA_MISMATCH: 7,
} as const;

export type ReconciliationDiscrepancyTypeCode =
  (typeof RECONCILIATION_DISCREPANCY_TYPE)[keyof typeof RECONCILIATION_DISCREPANCY_TYPE];

export type ReconciliationDiscrepancyTypeName =
  | 'MISSING_INTERNAL'
  | 'MISSING_EXTERNAL'
  | 'DUPLICATE_INTERNAL'
  | 'DUPLICATE_EXTERNAL'
  | 'STATUS_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'DATA_MISMATCH';

export const RECONCILIATION_SEVERITY = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
} as const;

export type ReconciliationSeverityCode =
  (typeof RECONCILIATION_SEVERITY)[keyof typeof RECONCILIATION_SEVERITY];

export type ReconciliationSeverityName = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export const RECONCILIATION_DISCREPANCY_STATUS = {
  OPEN: 1,
  ASSIGNED: 2,
  IN_REPAIR: 3,
  RESOLVED: 4,
  COMPENSATED: 5,
  IGNORED: 6,
} as const;

export type ReconciliationDiscrepancyStatusCode =
  (typeof RECONCILIATION_DISCREPANCY_STATUS)[keyof typeof RECONCILIATION_DISCREPANCY_STATUS];

export type ReconciliationDiscrepancyStatusName =
  | 'OPEN'
  | 'ASSIGNED'
  | 'IN_REPAIR'
  | 'RESOLVED'
  | 'COMPENSATED'
  | 'IGNORED';

export const DATA_REPAIR_ACTION_MODE = {
  DIRECT_REPAIR: 'DIRECT_REPAIR',
  COMPENSATING_ACTION: 'COMPENSATING_ACTION',
} as const;

export type DataRepairActionMode =
  (typeof DATA_REPAIR_ACTION_MODE)[keyof typeof DATA_REPAIR_ACTION_MODE];

export const DATA_REPAIR_STATUS = {
  DRAFT_PREVIEW: 1,
  PENDING_APPROVAL: 2,
  APPROVED: 3,
  REJECTED: 4,
  EXECUTED: 5,
  FAILED: 6,
  COMPENSATED: 7,
} as const;

export type DataRepairStatusCode = (typeof DATA_REPAIR_STATUS)[keyof typeof DATA_REPAIR_STATUS];

export type DataRepairStatusName =
  | 'DRAFT_PREVIEW'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'EXECUTED'
  | 'FAILED'
  | 'COMPENSATED';

export const DATA_REPAIR_EXECUTION_MODE = {
  DRY_RUN: 'DRY_RUN',
  APPLY: 'APPLY',
  COMPENSATE: 'COMPENSATE',
} as const;

export type DataRepairExecutionMode =
  (typeof DATA_REPAIR_EXECUTION_MODE)[keyof typeof DATA_REPAIR_EXECUTION_MODE];

export const DATA_REPAIR_EXECUTION_STATUS = {
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
} as const;

export type DataRepairExecutionStatus =
  (typeof DATA_REPAIR_EXECUTION_STATUS)[keyof typeof DATA_REPAIR_EXECUTION_STATUS];

export const RECONCILIATION_DEFAULTS = {
  HIGH_AMOUNT_DIFF_THRESHOLD: 1_000_000,
  CRITICAL_AMOUNT_DIFF_THRESHOLD: 10_000_000,
  SENSITIVE_AMOUNT_THRESHOLD: 1_000_000,
  REQUIRE_DRY_RUN_BEFORE_APPLY: true,
  MAX_RECORDS_PER_RUN: 5_000,
  RETENTION_DAYS: 90,
  DEFAULT_TOLERANCE_AMOUNT: 0,
} as const;

/** Một bản ghi đã chuẩn hóa dùng cho động cơ so sánh đối soát 2 chiều */
export interface ReconciliationComparableRecord {
  readonly recordKey: string;
  readonly entityType?: string | null | undefined;
  readonly entityId?: string | null | undefined;
  readonly status?: string | null | undefined;
  readonly amount?: number | null | undefined;
  readonly currency?: string | null | undefined;
  readonly occurredAt?: string | null | undefined;
  readonly fields?: Readonly<Record<string, unknown>> | undefined;
  readonly raw?: Readonly<Record<string, unknown>> | undefined;
}

export interface ReconciliationMatchingRules {
  readonly amountTolerance?: number | undefined;
  readonly compareFields?: readonly string[] | undefined;
  readonly statusAliases?: Readonly<Record<string, string>> | undefined;
  readonly ignoreCaseOnStatus?: boolean | undefined;
}

export interface ReconciliationAdapterContext {
  readonly jobCode: string;
  readonly jobConfig: Readonly<Record<string, unknown>>;
  readonly matchingRules: ReconciliationMatchingRules;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly maxRecords: number;
  readonly internalRecords?: readonly ReconciliationComparableRecord[] | undefined;
  readonly externalRecords?: readonly ReconciliationComparableRecord[] | undefined;
  readonly internalCsv?: string | undefined;
  readonly externalCsv?: string | undefined;
  readonly parameters?: Readonly<Record<string, unknown>> | undefined;
}

export interface ReconciliationDatasetPair {
  readonly internalRecords: readonly ReconciliationComparableRecord[];
  readonly externalRecords: readonly ReconciliationComparableRecord[];
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface ReconciliationAdapterMetadata {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly targetModule: string;
  readonly supportsExternalUpload: boolean;
  readonly defaultMatchingRules?: ReconciliationMatchingRules | undefined;
}

export interface IReconciliationSourceAdapter {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly targetModule: string;
  readonly supportsExternalUpload: boolean;
  readonly defaultMatchingRules?: ReconciliationMatchingRules | undefined;
  fetchData(context: ReconciliationAdapterContext): Promise<ReconciliationDatasetPair>;
}

export interface DataRepairFieldDiff {
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface DataRepairTargetInfo {
  readonly targetModule: string;
  readonly targetEntityType: string;
  readonly targetEntityId: string;
  readonly discrepancyId?: number | null | undefined;
  readonly discrepancyCode?: string | null | undefined;
  readonly discrepancyType?: ReconciliationDiscrepancyTypeName | null | undefined;
  readonly internalSnapshot?: Readonly<Record<string, unknown>> | null | undefined;
  readonly externalSnapshot?: Readonly<Record<string, unknown>> | null | undefined;
  readonly amountDiff?: number | null | undefined;
}

export interface DataRepairHandlerContext {
  readonly repairCode: string;
  readonly actionMode: DataRepairActionMode;
  readonly target: DataRepairTargetInfo;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly reason: string;
  readonly actorUserId: number | null;
  readonly dryRun: boolean;
}

export interface DataRepairCompensateContext extends DataRepairHandlerContext {
  readonly parentRepairCode?: string | null | undefined;
  readonly parentBeforeSnapshot?: Readonly<Record<string, unknown>> | null | undefined;
  readonly parentAfterSnapshot?: Readonly<Record<string, unknown>> | null | undefined;
  readonly compensationType: string;
}

export interface DataRepairPreviewOutcome {
  readonly affectedCount: number;
  readonly summary: string;
  readonly beforeSnapshot: Readonly<Record<string, unknown>>;
  readonly predictedAfterSnapshot: Readonly<Record<string, unknown>>;
  readonly fieldDiffs: readonly DataRepairFieldDiff[];
  readonly isSensitive: boolean;
  readonly sensitivityReasons: readonly string[];
  readonly canRollback: boolean;
  readonly warnings?: readonly string[] | undefined;
  readonly dryRunRolledBack?: boolean | undefined;
}

export interface DataRepairApplyOutcome {
  readonly affectedCount: number;
  readonly summary: string;
  readonly beforeSnapshot: Readonly<Record<string, unknown>>;
  readonly afterSnapshot: Readonly<Record<string, unknown>>;
  readonly fieldDiffs: readonly DataRepairFieldDiff[];
  readonly canRollback: boolean;
  readonly compensationDetails?: Readonly<Record<string, unknown>> | undefined;
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

export interface IDataRepairHandler {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly targetModule: string;
  readonly supportedModes: readonly DataRepairActionMode[];
  readonly alwaysSensitive?: boolean | undefined;
  readonly supportsRollback: boolean;
  preview(context: DataRepairHandlerContext): Promise<DataRepairPreviewOutcome>;
  apply(context: DataRepairHandlerContext): Promise<DataRepairApplyOutcome>;
  compensate?(context: DataRepairCompensateContext): Promise<DataRepairApplyOutcome>;
}

export interface IReconciliationRegistryPort {
  registerAdapter(adapter: IReconciliationSourceAdapter): void;
  getAdapter(code: string): IReconciliationSourceAdapter | null;
  listAdapters(): ReconciliationAdapterMetadata[];
  registerRepairHandler(handler: IDataRepairHandler): void;
  getRepairHandler(code: string): IDataRepairHandler | null;
  listRepairHandlers(): DataRepairHandlerMetadata[];
}

export function getReconciliationRunStatusName(status: number): ReconciliationRunStatusName {
  switch (status) {
    case RECONCILIATION_RUN_STATUS.RUNNING:
      return 'RUNNING';
    case RECONCILIATION_RUN_STATUS.COMPLETED:
      return 'COMPLETED';
    case RECONCILIATION_RUN_STATUS.FAILED:
      return 'FAILED';
    case RECONCILIATION_RUN_STATUS.QUEUED:
    default:
      return 'QUEUED';
  }
}

export function parseReconciliationRunStatus(raw: unknown): ReconciliationRunStatusCode | null {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    if (raw >= RECONCILIATION_RUN_STATUS.QUEUED && raw <= RECONCILIATION_RUN_STATUS.FAILED) {
      return raw as ReconciliationRunStatusCode;
    }
    return null;
  }
  if (typeof raw === 'string') {
    const clean = raw.trim().toUpperCase();
    if (/^\d+$/.test(clean)) return parseReconciliationRunStatus(Number(clean));
    switch (clean) {
      case 'QUEUED':
        return RECONCILIATION_RUN_STATUS.QUEUED;
      case 'RUNNING':
        return RECONCILIATION_RUN_STATUS.RUNNING;
      case 'COMPLETED':
        return RECONCILIATION_RUN_STATUS.COMPLETED;
      case 'FAILED':
        return RECONCILIATION_RUN_STATUS.FAILED;
      default:
        return null;
    }
  }
  return null;
}

export function getReconciliationDiscrepancyTypeName(
  typeCode: number,
): ReconciliationDiscrepancyTypeName {
  switch (typeCode) {
    case RECONCILIATION_DISCREPANCY_TYPE.MISSING_EXTERNAL:
      return 'MISSING_EXTERNAL';
    case RECONCILIATION_DISCREPANCY_TYPE.DUPLICATE_INTERNAL:
      return 'DUPLICATE_INTERNAL';
    case RECONCILIATION_DISCREPANCY_TYPE.DUPLICATE_EXTERNAL:
      return 'DUPLICATE_EXTERNAL';
    case RECONCILIATION_DISCREPANCY_TYPE.STATUS_MISMATCH:
      return 'STATUS_MISMATCH';
    case RECONCILIATION_DISCREPANCY_TYPE.AMOUNT_MISMATCH:
      return 'AMOUNT_MISMATCH';
    case RECONCILIATION_DISCREPANCY_TYPE.DATA_MISMATCH:
      return 'DATA_MISMATCH';
    case RECONCILIATION_DISCREPANCY_TYPE.MISSING_INTERNAL:
    default:
      return 'MISSING_INTERNAL';
  }
}

export function parseReconciliationDiscrepancyType(
  raw: unknown,
): ReconciliationDiscrepancyTypeCode | null {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    if (
      raw >= RECONCILIATION_DISCREPANCY_TYPE.MISSING_INTERNAL &&
      raw <= RECONCILIATION_DISCREPANCY_TYPE.DATA_MISMATCH
    ) {
      return raw as ReconciliationDiscrepancyTypeCode;
    }
    return null;
  }
  if (typeof raw === 'string') {
    const clean = raw.trim().toUpperCase();
    if (/^\d+$/.test(clean)) return parseReconciliationDiscrepancyType(Number(clean));
    switch (clean) {
      case 'MISSING_INTERNAL':
        return RECONCILIATION_DISCREPANCY_TYPE.MISSING_INTERNAL;
      case 'MISSING_EXTERNAL':
        return RECONCILIATION_DISCREPANCY_TYPE.MISSING_EXTERNAL;
      case 'DUPLICATE_INTERNAL':
        return RECONCILIATION_DISCREPANCY_TYPE.DUPLICATE_INTERNAL;
      case 'DUPLICATE_EXTERNAL':
        return RECONCILIATION_DISCREPANCY_TYPE.DUPLICATE_EXTERNAL;
      case 'STATUS_MISMATCH':
        return RECONCILIATION_DISCREPANCY_TYPE.STATUS_MISMATCH;
      case 'AMOUNT_MISMATCH':
        return RECONCILIATION_DISCREPANCY_TYPE.AMOUNT_MISMATCH;
      case 'DATA_MISMATCH':
        return RECONCILIATION_DISCREPANCY_TYPE.DATA_MISMATCH;
      default:
        return null;
    }
  }
  return null;
}

export function getReconciliationSeverityName(severity: number): ReconciliationSeverityName {
  switch (severity) {
    case RECONCILIATION_SEVERITY.MEDIUM:
      return 'MEDIUM';
    case RECONCILIATION_SEVERITY.HIGH:
      return 'HIGH';
    case RECONCILIATION_SEVERITY.CRITICAL:
      return 'CRITICAL';
    case RECONCILIATION_SEVERITY.LOW:
    default:
      return 'LOW';
  }
}

export function parseReconciliationSeverity(raw: unknown): ReconciliationSeverityCode | null {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    if (raw >= RECONCILIATION_SEVERITY.LOW && raw <= RECONCILIATION_SEVERITY.CRITICAL) {
      return raw as ReconciliationSeverityCode;
    }
    return null;
  }
  if (typeof raw === 'string') {
    const clean = raw.trim().toUpperCase();
    if (/^\d+$/.test(clean)) return parseReconciliationSeverity(Number(clean));
    switch (clean) {
      case 'LOW':
        return RECONCILIATION_SEVERITY.LOW;
      case 'MEDIUM':
        return RECONCILIATION_SEVERITY.MEDIUM;
      case 'HIGH':
        return RECONCILIATION_SEVERITY.HIGH;
      case 'CRITICAL':
        return RECONCILIATION_SEVERITY.CRITICAL;
      default:
        return null;
    }
  }
  return null;
}

export function getReconciliationDiscrepancyStatusName(
  status: number,
): ReconciliationDiscrepancyStatusName {
  switch (status) {
    case RECONCILIATION_DISCREPANCY_STATUS.ASSIGNED:
      return 'ASSIGNED';
    case RECONCILIATION_DISCREPANCY_STATUS.IN_REPAIR:
      return 'IN_REPAIR';
    case RECONCILIATION_DISCREPANCY_STATUS.RESOLVED:
      return 'RESOLVED';
    case RECONCILIATION_DISCREPANCY_STATUS.COMPENSATED:
      return 'COMPENSATED';
    case RECONCILIATION_DISCREPANCY_STATUS.IGNORED:
      return 'IGNORED';
    case RECONCILIATION_DISCREPANCY_STATUS.OPEN:
    default:
      return 'OPEN';
  }
}

export function parseReconciliationDiscrepancyStatus(
  raw: unknown,
): ReconciliationDiscrepancyStatusCode | null {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    if (
      raw >= RECONCILIATION_DISCREPANCY_STATUS.OPEN &&
      raw <= RECONCILIATION_DISCREPANCY_STATUS.IGNORED
    ) {
      return raw as ReconciliationDiscrepancyStatusCode;
    }
    return null;
  }
  if (typeof raw === 'string') {
    const clean = raw.trim().toUpperCase();
    if (/^\d+$/.test(clean)) return parseReconciliationDiscrepancyStatus(Number(clean));
    switch (clean) {
      case 'OPEN':
        return RECONCILIATION_DISCREPANCY_STATUS.OPEN;
      case 'ASSIGNED':
        return RECONCILIATION_DISCREPANCY_STATUS.ASSIGNED;
      case 'IN_REPAIR':
        return RECONCILIATION_DISCREPANCY_STATUS.IN_REPAIR;
      case 'RESOLVED':
        return RECONCILIATION_DISCREPANCY_STATUS.RESOLVED;
      case 'COMPENSATED':
        return RECONCILIATION_DISCREPANCY_STATUS.COMPENSATED;
      case 'IGNORED':
        return RECONCILIATION_DISCREPANCY_STATUS.IGNORED;
      default:
        return null;
    }
  }
  return null;
}

export function getDataRepairStatusName(status: number): DataRepairStatusName {
  switch (status) {
    case DATA_REPAIR_STATUS.PENDING_APPROVAL:
      return 'PENDING_APPROVAL';
    case DATA_REPAIR_STATUS.APPROVED:
      return 'APPROVED';
    case DATA_REPAIR_STATUS.REJECTED:
      return 'REJECTED';
    case DATA_REPAIR_STATUS.EXECUTED:
      return 'EXECUTED';
    case DATA_REPAIR_STATUS.FAILED:
      return 'FAILED';
    case DATA_REPAIR_STATUS.COMPENSATED:
      return 'COMPENSATED';
    case DATA_REPAIR_STATUS.DRAFT_PREVIEW:
    default:
      return 'DRAFT_PREVIEW';
  }
}

export function parseDataRepairStatus(raw: unknown): DataRepairStatusCode | null {
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    if (raw >= DATA_REPAIR_STATUS.DRAFT_PREVIEW && raw <= DATA_REPAIR_STATUS.COMPENSATED) {
      return raw as DataRepairStatusCode;
    }
    return null;
  }
  if (typeof raw === 'string') {
    const clean = raw.trim().toUpperCase();
    if (/^\d+$/.test(clean)) return parseDataRepairStatus(Number(clean));
    switch (clean) {
      case 'DRAFT_PREVIEW':
        return DATA_REPAIR_STATUS.DRAFT_PREVIEW;
      case 'PENDING_APPROVAL':
        return DATA_REPAIR_STATUS.PENDING_APPROVAL;
      case 'APPROVED':
        return DATA_REPAIR_STATUS.APPROVED;
      case 'REJECTED':
        return DATA_REPAIR_STATUS.REJECTED;
      case 'EXECUTED':
        return DATA_REPAIR_STATUS.EXECUTED;
      case 'FAILED':
        return DATA_REPAIR_STATUS.FAILED;
      case 'COMPENSATED':
        return DATA_REPAIR_STATUS.COMPENSATED;
      default:
        return null;
    }
  }
  return null;
}

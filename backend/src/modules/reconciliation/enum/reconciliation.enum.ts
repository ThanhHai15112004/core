export {
  DATA_REPAIR_ACTION_MODE,
  DATA_REPAIR_EXECUTION_MODE,
  DATA_REPAIR_EXECUTION_STATUS,
  DATA_REPAIR_STATUS,
  RECONCILIATION_DEFAULTS,
  RECONCILIATION_DISCREPANCY_STATUS,
  RECONCILIATION_DISCREPANCY_TYPE,
  RECONCILIATION_QUEUE_TOPICS,
  RECONCILIATION_RUN_STATUS,
  RECONCILIATION_SEVERITY,
  RECONCILIATION_TRIGGER_MODE,
  getDataRepairStatusName,
  getReconciliationDiscrepancyStatusName,
  getReconciliationDiscrepancyTypeName,
  getReconciliationRunStatusName,
  getReconciliationSeverityName,
  parseDataRepairStatus,
  parseReconciliationDiscrepancyStatus,
  parseReconciliationDiscrepancyType,
  parseReconciliationRunStatus,
  parseReconciliationSeverity,
  type DataRepairActionMode,
  type DataRepairExecutionMode,
  type DataRepairExecutionStatus,
  type DataRepairStatusCode,
  type DataRepairStatusName,
  type ReconciliationDiscrepancyStatusCode,
  type ReconciliationDiscrepancyStatusName,
  type ReconciliationDiscrepancyTypeCode,
  type ReconciliationDiscrepancyTypeName,
  type ReconciliationQueueTopic,
  type ReconciliationRunStatusCode,
  type ReconciliationRunStatusName,
  type ReconciliationSeverityCode,
  type ReconciliationSeverityName,
  type ReconciliationTriggerMode,
} from '@packages/kernel/index.js';

export const RECONCILIATION_SETTING_KEYS = {
  HIGH_AMOUNT_DIFF_THRESHOLD: 'reconciliation.high_amount_diff_threshold',
  CRITICAL_AMOUNT_DIFF_THRESHOLD: 'reconciliation.critical_amount_diff_threshold',
  SENSITIVE_AMOUNT_THRESHOLD: 'reconciliation.sensitive_amount_threshold',
  REQUIRE_DRY_RUN_BEFORE_APPLY: 'reconciliation.require_dry_run_before_apply',
  REQUIRE_APPROVAL_FOR_ALL_REPAIRS: 'reconciliation.require_approval_for_all_repairs',
  MAX_RECORDS_PER_RUN: 'reconciliation.max_records_per_run',
  RETENTION_DAYS: 'reconciliation.retention_days',
} as const;

export const RECONCILIATION_SEQUENCE_KEYS = {
  JOB_CODE: 'reconciliation.job_code',
  RUN_CODE: 'reconciliation.run_code',
  DISCREPANCY_CODE: 'reconciliation.discrepancy_code',
  REPAIR_CODE: 'reconciliation.repair_code',
} as const;

export const RECONCILIATION_EVENTS = {
  RUN_COMPLETED: 'reconciliation.run.completed',
  RUN_FAILED: 'reconciliation.run.failed',
  DISCREPANCY_ASSIGNED: 'reconciliation.discrepancy.assigned',
  REPAIR_PROPOSED: 'reconciliation.repair.proposed',
  REPAIR_APPROVED: 'reconciliation.repair.approved',
  REPAIR_REJECTED: 'reconciliation.repair.rejected',
  REPAIR_EXECUTED: 'reconciliation.repair.executed',
  REPAIR_COMPENSATED: 'reconciliation.repair.compensated',
} as const;

export const RECONCILIATION_AUDIT_META = {
  MODULE: 'reconciliation',
  FEATURES: {
    JOBS: 'jobs',
    RUNS: 'runs',
    DISCREPANCIES: 'discrepancies',
    REPAIRS: 'repairs',
  },
} as const;

export const RECONCILIATION_ADAPTER_CODES = {
  GENERIC_DATASET: 'generic-dataset',
  PAYMENTS_BRIDGE: 'payments-bridge',
} as const;

export const RECONCILIATION_REPAIR_HANDLER_CODES = {
  GENERIC_DATASET: 'generic-dataset-repair',
  PAYMENTS_BRIDGE: 'payments-bridge-repair',
} as const;

export const RECONCILIATION_COMPENSATION_TYPES = {
  ADJUSTMENT_ENTRY: 'ADJUSTMENT_ENTRY',
  CREDIT_NOTE: 'CREDIT_NOTE',
  DEBIT_NOTE: 'DEBIT_NOTE',
  REFUND_COMPENSATION: 'REFUND_COMPENSATION',
  MANUAL_REBOOK: 'MANUAL_REBOOK',
} as const;

export type ReconciliationCompensationType =
  (typeof RECONCILIATION_COMPENSATION_TYPES)[keyof typeof RECONCILIATION_COMPENSATION_TYPES];

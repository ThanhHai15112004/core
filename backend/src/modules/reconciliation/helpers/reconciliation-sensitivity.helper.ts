import type { DataRepairFieldDiff } from '@packages/kernel/index.js';
import {
  DATA_REPAIR_ACTION_MODE,
  RECONCILIATION_DISCREPANCY_TYPE,
  type DataRepairActionMode,
  type ReconciliationDiscrepancyTypeCode,
} from '../enum/reconciliation.enum.js';
import type { ReconciliationRuntimeConfig } from '../types/reconciliation.types.js';

const SENSITIVE_FIELD_NAMES = new Set([
  'amount',
  'refundedAmount',
  'balance',
  'credit',
  'debit',
  'currency',
  'settlementAmount',
  'bankAccount',
  'payoutAmount',
  'adjustmentAmount',
]);

/** Tính toán danh sách trường thay đổi giữa snapshot trước và sau */
export function computeFieldDiffs(
  beforeSnapshot: Readonly<Record<string, unknown>>,
  afterSnapshot: Readonly<Record<string, unknown>>,
): DataRepairFieldDiff[] {
  const keys = new Set<string>([...Object.keys(beforeSnapshot), ...Object.keys(afterSnapshot)]);
  const diffs: DataRepairFieldDiff[] = [];

  for (const key of keys) {
    const beforeVal = beforeSnapshot[key] ?? null;
    const afterVal = afterSnapshot[key] ?? null;
    if (JSON.stringify(beforeVal) !== JSON.stringify(afterVal)) {
      diffs.push({
        field: key,
        before: beforeVal,
        after: afterVal,
      });
    }
  }
  return diffs;
}

/**
 * Đánh giá xem một yêu cầu sửa dữ liệu có thuộc nhóm NHẠY CẢM (yêu cầu Maker-Checker duyệt 2 lớp) hay không.
 */
export function evaluateRepairSensitivity(params: {
  readonly actionMode: DataRepairActionMode;
  readonly handlerAlwaysSensitive?: boolean | undefined;
  readonly previewIsSensitive?: boolean | undefined;
  readonly previewReasons?: readonly string[] | undefined;
  readonly discrepancyType?: ReconciliationDiscrepancyTypeCode | null | undefined;
  readonly amountDiff?: number | null | undefined;
  readonly payload?: Readonly<Record<string, unknown>> | undefined;
  readonly fieldDiffs?: readonly DataRepairFieldDiff[] | undefined;
  readonly forceSensitive?: boolean | undefined;
  readonly runtimeConfig: ReconciliationRuntimeConfig;
}): { readonly isSensitive: boolean; readonly reasons: string[] } {
  const reasons: string[] = [...(params.previewReasons ?? [])];

  if (params.runtimeConfig.requireApprovalForAllRepairs) {
    reasons.push('Global policy requires Maker-Checker approval for all data repairs');
  }
  if (params.forceSensitive) {
    reasons.push('Explicitly flagged as sensitive by proposer');
  }
  if (params.handlerAlwaysSensitive) {
    reasons.push('Target repair handler is marked as sensitive');
  }
  if (params.actionMode === DATA_REPAIR_ACTION_MODE.COMPENSATING_ACTION) {
    reasons.push('Compensating action modifies financial/ledger trail and requires approval');
  }
  if (params.discrepancyType === RECONCILIATION_DISCREPANCY_TYPE.AMOUNT_MISMATCH) {
    reasons.push('Discrepancy involves financial amount mismatch');
  }

  const candidateAmounts: number[] = [];
  if (typeof params.amountDiff === 'number' && !Number.isNaN(params.amountDiff)) {
    candidateAmounts.push(Math.abs(params.amountDiff));
  }
  const payloadAmount =
    params.payload?.amount ?? params.payload?.adjustmentAmount ?? params.payload?.refundAmount;
  if (typeof payloadAmount === 'number' && !Number.isNaN(payloadAmount)) {
    candidateAmounts.push(Math.abs(payloadAmount));
  }

  const maxAmount = candidateAmounts.length > 0 ? Math.max(...candidateAmounts) : 0;
  if (maxAmount >= params.runtimeConfig.sensitiveAmountThreshold && maxAmount > 0) {
    reasons.push(
      `Amount impact (${maxAmount}) reaches sensitive approval threshold (${params.runtimeConfig.sensitiveAmountThreshold})`,
    );
  }

  for (const diff of params.fieldDiffs ?? []) {
    if (SENSITIVE_FIELD_NAMES.has(diff.field)) {
      reasons.push(`Modifies sensitive field "${diff.field}"`);
    }
  }

  const uniqueReasons = Array.from(new Set(reasons));
  const isSensitive = Boolean(params.previewIsSensitive) || uniqueReasons.length > 0;
  return { isSensitive, reasons: uniqueReasons };
}

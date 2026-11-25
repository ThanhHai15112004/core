import type {
  ReconciliationComparableRecord,
  ReconciliationMatchingRules,
} from '@packages/kernel/index.js';
import {
  RECONCILIATION_DISCREPANCY_TYPE,
  RECONCILIATION_SEVERITY,
  type ReconciliationDiscrepancyTypeCode,
  type ReconciliationSeverityCode,
} from '../enum/reconciliation.enum.js';
import type { ReconciliationRuntimeConfig } from '../types/reconciliation.types.js';

export interface ClassifiedDiscrepancyDraft {
  readonly recordKey: string;
  readonly entityType: string | null;
  readonly entityId: string | null;
  readonly discrepancyType: ReconciliationDiscrepancyTypeCode;
  readonly severity: ReconciliationSeverityCode;
  readonly internalStatus: string | null;
  readonly externalStatus: string | null;
  readonly internalAmount: number | null;
  readonly externalAmount: number | null;
  readonly amountDiff: number | null;
  readonly currency: string | null;
  readonly internalSnapshot: Record<string, unknown> | null;
  readonly externalSnapshot: Record<string, unknown> | null;
  readonly diffFields: Record<string, unknown>;
}

export interface ReconciliationComparisonOutput {
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
  readonly discrepancies: readonly ClassifiedDiscrepancyDraft[];
}

function normalizeKey(raw: string): string {
  return raw.trim();
}

function normalizeStatus(
  status: string | null | undefined,
  rules: ReconciliationMatchingRules,
): string | null {
  if (status === null || status === undefined) return null;
  const trimmed = String(status).trim();
  if (!trimmed) return null;
  const aliased =
    rules.statusAliases?.[trimmed] ??
    rules.statusAliases?.[trimmed.toUpperCase()] ??
    trimmed;
  return rules.ignoreCaseOnStatus === false ? aliased : aliased.toUpperCase();
}

function toSnapshot(record: ReconciliationComparableRecord): Record<string, unknown> {
  return {
    recordKey: record.recordKey,
    ...(record.entityType ? { entityType: record.entityType } : {}),
    ...(record.entityId ? { entityId: record.entityId } : {}),
    ...(record.status !== undefined ? { status: record.status } : {}),
    ...(record.amount !== undefined ? { amount: record.amount } : {}),
    ...(record.currency !== undefined ? { currency: record.currency } : {}),
    ...(record.occurredAt !== undefined ? { occurredAt: record.occurredAt } : {}),
    ...(record.fields && Object.keys(record.fields).length > 0 ? { fields: record.fields } : {}),
    ...(record.raw && Object.keys(record.raw).length > 0 ? { raw: record.raw } : {}),
  };
}

export function classifyDiscrepancySeverity(
  type: ReconciliationDiscrepancyTypeCode,
  amountDiff: number | null,
  config: ReconciliationRuntimeConfig,
): ReconciliationSeverityCode {
  const absDiff = amountDiff !== null ? Math.abs(amountDiff) : 0;
  if (absDiff >= config.criticalAmountDiffThreshold) {
    return RECONCILIATION_SEVERITY.CRITICAL;
  }
  if (absDiff >= config.highAmountDiffThreshold) {
    return RECONCILIATION_SEVERITY.HIGH;
  }

  switch (type) {
    case RECONCILIATION_DISCREPANCY_TYPE.AMOUNT_MISMATCH:
      return absDiff > 0 ? RECONCILIATION_SEVERITY.HIGH : RECONCILIATION_SEVERITY.MEDIUM;
    case RECONCILIATION_DISCREPANCY_TYPE.MISSING_INTERNAL:
    case RECONCILIATION_DISCREPANCY_TYPE.MISSING_EXTERNAL:
      return absDiff > 0 ? RECONCILIATION_SEVERITY.HIGH : RECONCILIATION_SEVERITY.MEDIUM;
    case RECONCILIATION_DISCREPANCY_TYPE.DUPLICATE_INTERNAL:
    case RECONCILIATION_DISCREPANCY_TYPE.DUPLICATE_EXTERNAL:
      return RECONCILIATION_SEVERITY.HIGH;
    case RECONCILIATION_DISCREPANCY_TYPE.STATUS_MISMATCH:
      return RECONCILIATION_SEVERITY.MEDIUM;
    case RECONCILIATION_DISCREPANCY_TYPE.DATA_MISMATCH:
    default:
      return RECONCILIATION_SEVERITY.LOW;
  }
}

/**
 * Động cơ so sánh đối soát 2 chiều Nội bộ vs Nguồn ngoài (11.5).
 * Phát hiện và phân loại rõ 4 nhóm cốt lõi + mở rộng:
 * - Thiếu 2 chiều (`MISSING_INTERNAL`, `MISSING_EXTERNAL`)
 * - Trùng 2 chiều (`DUPLICATE_INTERNAL`, `DUPLICATE_EXTERNAL`)
 * - Sai số tiền / tiền tệ (`AMOUNT_MISMATCH`)
 * - Sai trạng thái (`STATUS_MISMATCH`)
 * - Sai trường dữ liệu bổ sung (`DATA_MISMATCH`)
 */
export function runReconciliationComparison(params: {
  readonly internalRecords: readonly ReconciliationComparableRecord[];
  readonly externalRecords: readonly ReconciliationComparableRecord[];
  readonly matchingRules?: ReconciliationMatchingRules | undefined;
  readonly runtimeConfig: ReconciliationRuntimeConfig;
}): ReconciliationComparisonOutput {
  const rules: ReconciliationMatchingRules = params.matchingRules ?? {};
  const amountTolerance = Math.max(0, Number(rules.amountTolerance ?? 0));
  const compareFields = rules.compareFields ?? [];

  const internalByKey = new Map<string, ReconciliationComparableRecord[]>();
  const externalByKey = new Map<string, ReconciliationComparableRecord[]>();
  const currencies = new Set<string>();

  let internalTotalAmount = 0;
  let externalTotalAmount = 0;

  for (const rec of params.internalRecords) {
    const key = normalizeKey(rec.recordKey);
    if (!key) continue;
    const bucket = internalByKey.get(key) ?? [];
    bucket.push(rec);
    internalByKey.set(key, bucket);
    if (typeof rec.amount === 'number' && !Number.isNaN(rec.amount)) {
      internalTotalAmount += Math.trunc(rec.amount);
    }
    if (rec.currency) currencies.add(rec.currency.trim().toUpperCase());
  }

  for (const rec of params.externalRecords) {
    const key = normalizeKey(rec.recordKey);
    if (!key) continue;
    const bucket = externalByKey.get(key) ?? [];
    bucket.push(rec);
    externalByKey.set(key, bucket);
    if (typeof rec.amount === 'number' && !Number.isNaN(rec.amount)) {
      externalTotalAmount += Math.trunc(rec.amount);
    }
    if (rec.currency) currencies.add(rec.currency.trim().toUpperCase());
  }

  const allKeys = new Set<string>([...internalByKey.keys(), ...externalByKey.keys()]);
  const discrepancies: ClassifiedDiscrepancyDraft[] = [];

  let matchedCount = 0;
  let missingInternalCount = 0;
  let missingExternalCount = 0;
  let duplicateCount = 0;
  let statusMismatchCount = 0;
  let amountMismatchCount = 0;
  let dataMismatchCount = 0;

  for (const key of allKeys) {
    const intList = internalByKey.get(key) ?? [];
    const extList = externalByKey.get(key) ?? [];

    // 1. Trùng lặp trong nội bộ
    if (intList.length > 1) {
      duplicateCount++;
      const primary = intList[0]!;
      const totalDupAmount = intList.reduce(
        (sum, r) => sum + (typeof r.amount === 'number' ? Math.trunc(r.amount) : 0),
        0,
      );
      const extAmount =
        extList.length === 1 && typeof extList[0]?.amount === 'number'
          ? Math.trunc(extList[0].amount)
          : 0;
      const diff = totalDupAmount - extAmount;
      discrepancies.push({
        recordKey: key,
        entityType: primary.entityType ?? null,
        entityId: primary.entityId ?? key,
        discrepancyType: RECONCILIATION_DISCREPANCY_TYPE.DUPLICATE_INTERNAL,
        severity: classifyDiscrepancySeverity(
          RECONCILIATION_DISCREPANCY_TYPE.DUPLICATE_INTERNAL,
          diff,
          params.runtimeConfig,
        ),
        internalStatus: primary.status ?? null,
        externalStatus: extList[0]?.status ?? null,
        internalAmount: totalDupAmount,
        externalAmount: extList.length > 0 ? extAmount : null,
        amountDiff: diff,
        currency: primary.currency ?? extList[0]?.currency ?? null,
        internalSnapshot: {
          duplicateCount: intList.length,
          records: intList.map(toSnapshot),
        },
        externalSnapshot: extList[0] ? toSnapshot(extList[0]) : null,
        diffFields: {
          reason: `Found ${intList.length} duplicate internal records for key "${key}"`,
          duplicateCount: intList.length,
        },
      });
    }

    // 2. Trùng lặp ở nguồn ngoài
    if (extList.length > 1) {
      duplicateCount++;
      const primary = extList[0]!;
      const totalDupAmount = extList.reduce(
        (sum, r) => sum + (typeof r.amount === 'number' ? Math.trunc(r.amount) : 0),
        0,
      );
      const intAmount =
        intList.length === 1 && typeof intList[0]?.amount === 'number'
          ? Math.trunc(intList[0].amount)
          : 0;
      const diff = intAmount - totalDupAmount;
      discrepancies.push({
        recordKey: key,
        entityType: intList[0]?.entityType ?? primary.entityType ?? null,
        entityId: intList[0]?.entityId ?? primary.entityId ?? key,
        discrepancyType: RECONCILIATION_DISCREPANCY_TYPE.DUPLICATE_EXTERNAL,
        severity: classifyDiscrepancySeverity(
          RECONCILIATION_DISCREPANCY_TYPE.DUPLICATE_EXTERNAL,
          diff,
          params.runtimeConfig,
        ),
        internalStatus: intList[0]?.status ?? null,
        externalStatus: primary.status ?? null,
        internalAmount: intList.length > 0 ? intAmount : null,
        externalAmount: totalDupAmount,
        amountDiff: diff,
        currency: intList[0]?.currency ?? primary.currency ?? null,
        internalSnapshot: intList[0] ? toSnapshot(intList[0]) : null,
        externalSnapshot: {
          duplicateCount: extList.length,
          records: extList.map(toSnapshot),
        },
        diffFields: {
          reason: `Found ${extList.length} duplicate external records for key "${key}"`,
          duplicateCount: extList.length,
        },
      });
    }

    if (intList.length > 1 || extList.length > 1) {
      continue;
    }

    // 3. Thiếu ở nguồn ngoài
    if (intList.length === 1 && extList.length === 0) {
      missingExternalCount++;
      const intRec = intList[0]!;
      const intAmt = typeof intRec.amount === 'number' ? Math.trunc(intRec.amount) : null;
      discrepancies.push({
        recordKey: key,
        entityType: intRec.entityType ?? null,
        entityId: intRec.entityId ?? key,
        discrepancyType: RECONCILIATION_DISCREPANCY_TYPE.MISSING_EXTERNAL,
        severity: classifyDiscrepancySeverity(
          RECONCILIATION_DISCREPANCY_TYPE.MISSING_EXTERNAL,
          intAmt,
          params.runtimeConfig,
        ),
        internalStatus: intRec.status ?? null,
        externalStatus: null,
        internalAmount: intAmt,
        externalAmount: null,
        amountDiff: intAmt,
        currency: intRec.currency ?? null,
        internalSnapshot: toSnapshot(intRec),
        externalSnapshot: null,
        diffFields: {
          reason: 'Record exists internally but is missing in external source',
        },
      });
      continue;
    }

    // 4. Thiếu trong nội bộ
    if (intList.length === 0 && extList.length === 1) {
      missingInternalCount++;
      const extRec = extList[0]!;
      const extAmt = typeof extRec.amount === 'number' ? Math.trunc(extRec.amount) : null;
      const diff = extAmt !== null ? -extAmt : null;
      discrepancies.push({
        recordKey: key,
        entityType: extRec.entityType ?? null,
        entityId: extRec.entityId ?? key,
        discrepancyType: RECONCILIATION_DISCREPANCY_TYPE.MISSING_INTERNAL,
        severity: classifyDiscrepancySeverity(
          RECONCILIATION_DISCREPANCY_TYPE.MISSING_INTERNAL,
          diff,
          params.runtimeConfig,
        ),
        internalStatus: null,
        externalStatus: extRec.status ?? null,
        internalAmount: null,
        externalAmount: extAmt,
        amountDiff: diff,
        currency: extRec.currency ?? null,
        internalSnapshot: null,
        externalSnapshot: toSnapshot(extRec),
        diffFields: {
          reason: 'Record exists in external source but is missing internally',
        },
      });
      continue;
    }

    // 5. Khớp 1-1: kiểm tra số tiền/tiền tệ -> trạng thái -> trường bổ sung
    const intRec = intList[0]!;
    const extRec = extList[0]!;
    const intAmt = typeof intRec.amount === 'number' ? Math.trunc(intRec.amount) : null;
    const extAmt = typeof extRec.amount === 'number' ? Math.trunc(extRec.amount) : null;
    const amountDiff = intAmt !== null && extAmt !== null ? intAmt - extAmt : null;
    const intCurrency = intRec.currency?.trim().toUpperCase() ?? null;
    const extCurrency = extRec.currency?.trim().toUpperCase() ?? null;
    const currencyMismatch = Boolean(intCurrency && extCurrency && intCurrency !== extCurrency);
    const amountMismatch =
      (amountDiff !== null && Math.abs(amountDiff) > amountTolerance) ||
      (intAmt !== null && extAmt === null) ||
      (intAmt === null && extAmt !== null) ||
      currencyMismatch;

    const intStatusNorm = normalizeStatus(intRec.status, rules);
    const extStatusNorm = normalizeStatus(extRec.status, rules);
    const statusMismatch = intStatusNorm !== extStatusNorm;

    const fieldMismatches: Record<string, { before: unknown; after: unknown }> = {};
    for (const field of compareFields) {
      const a = intRec.fields?.[field] ?? intRec.raw?.[field];
      const b = extRec.fields?.[field] ?? extRec.raw?.[field];
      if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
        fieldMismatches[field] = { before: a ?? null, after: b ?? null };
      }
    }

    if (amountMismatch) {
      amountMismatchCount++;
      discrepancies.push({
        recordKey: key,
        entityType: intRec.entityType ?? extRec.entityType ?? null,
        entityId: intRec.entityId ?? extRec.entityId ?? key,
        discrepancyType: RECONCILIATION_DISCREPANCY_TYPE.AMOUNT_MISMATCH,
        severity: classifyDiscrepancySeverity(
          RECONCILIATION_DISCREPANCY_TYPE.AMOUNT_MISMATCH,
          amountDiff ?? intAmt ?? extAmt,
          params.runtimeConfig,
        ),
        internalStatus: intRec.status ?? null,
        externalStatus: extRec.status ?? null,
        internalAmount: intAmt,
        externalAmount: extAmt,
        amountDiff,
        currency: intCurrency ?? extCurrency,
        internalSnapshot: toSnapshot(intRec),
        externalSnapshot: toSnapshot(extRec),
        diffFields: {
          amountMismatch: true,
          currencyMismatch,
          statusMismatch,
          internalAmount: intAmt,
          externalAmount: extAmt,
          amountDiff,
          internalCurrency: intCurrency,
          externalCurrency: extCurrency,
          ...(statusMismatch
            ? { internalStatus: intRec.status ?? null, externalStatus: extRec.status ?? null }
            : {}),
          ...(Object.keys(fieldMismatches).length > 0 ? { extraFields: fieldMismatches } : {}),
        },
      });
      continue;
    }

    if (statusMismatch) {
      statusMismatchCount++;
      discrepancies.push({
        recordKey: key,
        entityType: intRec.entityType ?? extRec.entityType ?? null,
        entityId: intRec.entityId ?? extRec.entityId ?? key,
        discrepancyType: RECONCILIATION_DISCREPANCY_TYPE.STATUS_MISMATCH,
        severity: classifyDiscrepancySeverity(
          RECONCILIATION_DISCREPANCY_TYPE.STATUS_MISMATCH,
          amountDiff,
          params.runtimeConfig,
        ),
        internalStatus: intRec.status ?? null,
        externalStatus: extRec.status ?? null,
        internalAmount: intAmt,
        externalAmount: extAmt,
        amountDiff: 0,
        currency: intCurrency ?? extCurrency,
        internalSnapshot: toSnapshot(intRec),
        externalSnapshot: toSnapshot(extRec),
        diffFields: {
          statusMismatch: true,
          internalStatus: intRec.status ?? null,
          externalStatus: extRec.status ?? null,
          ...(Object.keys(fieldMismatches).length > 0 ? { extraFields: fieldMismatches } : {}),
        },
      });
      continue;
    }

    if (Object.keys(fieldMismatches).length > 0) {
      dataMismatchCount++;
      discrepancies.push({
        recordKey: key,
        entityType: intRec.entityType ?? extRec.entityType ?? null,
        entityId: intRec.entityId ?? extRec.entityId ?? key,
        discrepancyType: RECONCILIATION_DISCREPANCY_TYPE.DATA_MISMATCH,
        severity: classifyDiscrepancySeverity(
          RECONCILIATION_DISCREPANCY_TYPE.DATA_MISMATCH,
          0,
          params.runtimeConfig,
        ),
        internalStatus: intRec.status ?? null,
        externalStatus: extRec.status ?? null,
        internalAmount: intAmt,
        externalAmount: extAmt,
        amountDiff: 0,
        currency: intCurrency ?? extCurrency,
        internalSnapshot: toSnapshot(intRec),
        externalSnapshot: toSnapshot(extRec),
        diffFields: {
          fieldMismatches,
        },
      });
      continue;
    }

    matchedCount++;
  }

  const singleCurrency =
    currencies.size === 0 ? null : currencies.size === 1 ? Array.from(currencies)[0]! : 'MULTI';

  return {
    totalInternalCount: params.internalRecords.length,
    totalExternalCount: params.externalRecords.length,
    matchedCount,
    discrepancyCount: discrepancies.length,
    missingInternalCount,
    missingExternalCount,
    duplicateCount,
    statusMismatchCount,
    amountMismatchCount,
    dataMismatchCount,
    internalTotalAmount,
    externalTotalAmount,
    amountDiffTotal: internalTotalAmount - externalTotalAmount,
    currency: singleCurrency,
    discrepancies,
  };
}

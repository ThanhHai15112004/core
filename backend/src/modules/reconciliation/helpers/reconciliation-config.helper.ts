import { randomUUID } from 'node:crypto';
import {
  BadRequestAppException,
  SequenceRegistryService,
  SettingRegistryService,
  cleanSpreadsheetCell,
  createSpreadsheetColumnFinder,
  defaultSequenceRegistry,
  defaultSettingRegistry,
  detectSpreadsheetHeaderRowIndex,
  parseCsvToMatrix,
  type ReconciliationComparableRecord,
} from '@packages/kernel/index.js';
import {
  RECONCILIATION_DEFAULTS,
  RECONCILIATION_SETTING_KEYS,
} from '../enum/reconciliation.enum.js';
import type { ReconciliationRuntimeConfig } from '../types/reconciliation.types.js';

export function resolveReconciliationRuntimeConfig(
  settingRegistry: SettingRegistryService = defaultSettingRegistry,
): ReconciliationRuntimeConfig {
  return {
    highAmountDiffThreshold: settingRegistry.getNumber(
      RECONCILIATION_SETTING_KEYS.HIGH_AMOUNT_DIFF_THRESHOLD,
      undefined,
      RECONCILIATION_DEFAULTS.HIGH_AMOUNT_DIFF_THRESHOLD,
    ),
    criticalAmountDiffThreshold: settingRegistry.getNumber(
      RECONCILIATION_SETTING_KEYS.CRITICAL_AMOUNT_DIFF_THRESHOLD,
      undefined,
      RECONCILIATION_DEFAULTS.CRITICAL_AMOUNT_DIFF_THRESHOLD,
    ),
    sensitiveAmountThreshold: settingRegistry.getNumber(
      RECONCILIATION_SETTING_KEYS.SENSITIVE_AMOUNT_THRESHOLD,
      undefined,
      RECONCILIATION_DEFAULTS.SENSITIVE_AMOUNT_THRESHOLD,
    ),
    requireDryRunBeforeApply: settingRegistry.getBoolean(
      RECONCILIATION_SETTING_KEYS.REQUIRE_DRY_RUN_BEFORE_APPLY,
      undefined,
      RECONCILIATION_DEFAULTS.REQUIRE_DRY_RUN_BEFORE_APPLY,
    ),
    requireApprovalForAllRepairs: settingRegistry.getBoolean(
      RECONCILIATION_SETTING_KEYS.REQUIRE_APPROVAL_FOR_ALL_REPAIRS,
      undefined,
      false,
    ),
    maxRecordsPerRun: settingRegistry.getNumber(
      RECONCILIATION_SETTING_KEYS.MAX_RECORDS_PER_RUN,
      undefined,
      RECONCILIATION_DEFAULTS.MAX_RECORDS_PER_RUN,
    ),
    retentionDays: settingRegistry.getNumber(
      RECONCILIATION_SETTING_KEYS.RETENTION_DAYS,
      undefined,
      RECONCILIATION_DEFAULTS.RETENTION_DAYS,
    ),
  };
}

export async function allocateReconciliationCode(
  sequenceRegistry: SequenceRegistryService | undefined,
  sequenceKey: string,
  fallbackPrefix: string,
): Promise<string> {
  const registry = sequenceRegistry ?? defaultSequenceRegistry;
  try {
    const generated = await registry.nextCode(sequenceKey);
    return generated.code;
  } catch {
    return `${fallbackPrefix}-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  }
}

/**
 * Chuyển đổi CSV sao kê / tập dữ liệu đối soát thành mảng `ReconciliationComparableRecord`.
 * Hỗ trợ nhiều tên cột phổ biến (`recordKey`, `paymentCode`, `orderCode`, `code`, `id`, `status`, `amount`, `currency`, `occurredAt`).
 */
export function parseComparableRecordsFromCsv(
  csvContent: string,
): ReconciliationComparableRecord[] {
  const matrix = parseCsvToMatrix(csvContent);
  if (matrix.length < 2) {
    throw new BadRequestAppException('reconciliation.invalidCsvInput');
  }

  const headerIdx = detectSpreadsheetHeaderRowIndex(matrix, [
    'recordkey',
    'record_key',
    'paymentcode',
    'payment_code',
    'ordercode',
    'order_code',
    'code',
    'key',
    'status',
    'amount',
  ]);
  const headerRow = matrix[headerIdx] ?? [];
  const finder = createSpreadsheetColumnFinder(headerRow);

  const keyCol = finder([
    'recordkey',
    'record_key',
    'paymentcode',
    'payment_code',
    'merchantorderref',
    'merchant_order_ref',
    'ordercode',
    'order_code',
    'code',
    'key',
    'id',
  ]);
  if (keyCol < 0) {
    throw new BadRequestAppException('reconciliation.invalidCsvInput');
  }

  const entityTypeCol = finder(['entitytype', 'entity_type', 'type']);
  const entityIdCol = finder(['entityid', 'entity_id', 'id', 'transactionid']);
  const statusCol = finder(['status', 'state', 'trạng thái']);
  const amountCol = finder(['amount', 'totalamount', 'total_amount', 'số tiền']);
  const currencyCol = finder(['currency', 'ccy', 'tiền tệ']);
  const occurredAtCol = finder([
    'occurredat',
    'occurred_at',
    'paidat',
    'paid_at',
    'createdat',
    'date',
  ]);

  const normalizedHeaders = headerRow.map(
    (cell, idx) => cleanSpreadsheetCell(cell) || `col_${idx}`,
  );
  const records: ReconciliationComparableRecord[] = [];

  for (let rowIdx = headerIdx + 1; rowIdx < matrix.length; rowIdx++) {
    const row = matrix[rowIdx];
    if (!row || row.every((c) => !cleanSpreadsheetCell(c))) continue;

    const recordKey = cleanSpreadsheetCell(row[keyCol] ?? '');
    if (!recordKey) continue;

    const rawAmount = amountCol >= 0 ? cleanSpreadsheetCell(row[amountCol] ?? '') : '';
    const parsedAmount = rawAmount !== '' ? Number(rawAmount.replace(/,/g, '')) : null;
    const statusRaw = statusCol >= 0 ? cleanSpreadsheetCell(row[statusCol] ?? '') : '';
    const currencyRaw = currencyCol >= 0 ? cleanSpreadsheetCell(row[currencyCol] ?? '') : '';
    const entityTypeRaw = entityTypeCol >= 0 ? cleanSpreadsheetCell(row[entityTypeCol] ?? '') : '';
    const entityIdRaw = entityIdCol >= 0 ? cleanSpreadsheetCell(row[entityIdCol] ?? '') : '';
    const occurredAtRaw = occurredAtCol >= 0 ? cleanSpreadsheetCell(row[occurredAtCol] ?? '') : '';

    const rawRecord: Record<string, unknown> = {};
    const fields: Record<string, unknown> = {};
    for (let c = 0; c < normalizedHeaders.length; c++) {
      const colName = normalizedHeaders[c]!;
      const val = cleanSpreadsheetCell(row[c] ?? '');
      rawRecord[colName] = val;
      if (
        c !== keyCol &&
        c !== statusCol &&
        c !== amountCol &&
        c !== currencyCol &&
        c !== entityTypeCol &&
        c !== entityIdCol &&
        c !== occurredAtCol &&
        val !== ''
      ) {
        fields[colName] = val;
      }
    }

    records.push({
      recordKey,
      entityType: entityTypeRaw || null,
      entityId: entityIdRaw || recordKey,
      status: statusRaw || null,
      amount:
        parsedAmount !== null && !Number.isNaN(parsedAmount) ? Math.trunc(parsedAmount) : null,
      currency: currencyRaw ? currencyRaw.toUpperCase() : null,
      occurredAt: occurredAtRaw || null,
      fields,
      raw: rawRecord,
    });
  }

  return records;
}

/**
 * Ước lượng thời điểm chạy kế tiếp đơn giản từ biểu thức cron phổ biến (không phụ thuộc lib ngoài).
 * Hỗ trợ `* /N * * * *` (mỗi N phút), `0 * /N * * *` (mỗi N giờ), `M H * * *` (hàng ngày).
 */
export function computeNextRunAt(
  scheduleCron: string | null | undefined,
  from = new Date(),
): Date | null {
  const cron = scheduleCron?.trim();
  if (!cron) return null;
  const parts = cron.split(/\s+/);
  if (parts.length !== 5) {
    return new Date(from.getTime() + 60 * 60 * 1000);
  }

  const [minExpr, hourExpr] = parts;
  const everyMinMatch = minExpr?.match(/^\*\/(\d+)$/);
  if (everyMinMatch) {
    const mins = Math.max(1, Number(everyMinMatch[1]));
    return new Date(from.getTime() + mins * 60 * 1000);
  }

  const everyHourMatch = hourExpr?.match(/^\*\/(\d+)$/);
  if (everyHourMatch) {
    const hours = Math.max(1, Number(everyHourMatch[1]));
    return new Date(from.getTime() + hours * 60 * 60 * 1000);
  }

  if (minExpr && /^\d+$/.test(minExpr) && hourExpr && /^\d+$/.test(hourExpr)) {
    const targetHour = Math.min(23, Math.max(0, Number(hourExpr)));
    const targetMin = Math.min(59, Math.max(0, Number(minExpr)));
    const next = new Date(from.getTime());
    next.setSeconds(0, 0);
    next.setHours(targetHour, targetMin, 0, 0);
    if (next.getTime() <= from.getTime()) {
      next.setDate(next.getDate() + 1);
    }
    return next;
  }

  return new Date(from.getTime() + 60 * 60 * 1000);
}

import { randomUUID } from 'node:crypto';
import {
  BadRequestAppException,
  SettingRegistryService,
  SequenceRegistryService,
  cleanSpreadsheetCell,
  createSpreadsheetColumnFinder,
  defaultSequenceRegistry,
  defaultSettingRegistry,
  detectSpreadsheetHeaderRowIndex,
  parseCsvToMatrix,
} from '@packages/kernel/index.js';
import {
  PAYMENT_DEFAULTS,
  PAYMENT_SETTING_KEYS,
  PAYMENT_TRANSACTION_STATUS,
  type PaymentTransactionStatusCode,
} from '../enum/payments.enum.js';
import type { PaymentRuntimeConfig, ProviderStatementRecord } from '../types/payments.types.js';

export function resolvePaymentRuntimeConfig(
  settingRegistry: SettingRegistryService = defaultSettingRegistry,
): PaymentRuntimeConfig {
  const rawCurrency = settingRegistry.getString(
    PAYMENT_SETTING_KEYS.DEFAULT_CURRENCY,
    undefined,
    PAYMENT_DEFAULTS.DEFAULT_CURRENCY,
  );
  return {
    defaultCurrency: normalizeCurrencyCode(rawCurrency || PAYMENT_DEFAULTS.DEFAULT_CURRENCY),
    defaultExpirySeconds: settingRegistry.getNumber(
      PAYMENT_SETTING_KEYS.DEFAULT_EXPIRY_SECONDS,
      undefined,
      PAYMENT_DEFAULTS.DEFAULT_EXPIRY_SECONDS,
    ),
    callbackToleranceSec: settingRegistry.getNumber(
      PAYMENT_SETTING_KEYS.CALLBACK_TOLERANCE_SEC,
      undefined,
      PAYMENT_DEFAULTS.CALLBACK_TOLERANCE_SEC,
    ),
    maxStoredPayloadBytes: settingRegistry.getNumber(
      PAYMENT_SETTING_KEYS.MAX_STORED_PAYLOAD_BYTES,
      undefined,
      PAYMENT_DEFAULTS.MAX_STORED_PAYLOAD_BYTES,
    ),
    recordRejectedCallbacks: settingRegistry.getBoolean(
      PAYMENT_SETTING_KEYS.RECORD_REJECTED_CALLBACKS,
      undefined,
      PAYMENT_DEFAULTS.RECORD_REJECTED_CALLBACKS,
    ),
    reconcileMaxLiveQueries: settingRegistry.getNumber(
      PAYMENT_SETTING_KEYS.RECONCILE_MAX_LIVE_QUERIES,
      undefined,
      PAYMENT_DEFAULTS.RECONCILE_MAX_LIVE_QUERIES,
    ),
  };
}

export function normalizeCurrencyCode(raw: string): string {
  const clean = raw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(clean)) {
    throw new BadRequestAppException('payments.currencyNotSupported', [{ currency: raw }]);
  }
  return clean;
}

export async function allocatePaymentCode(
  sequenceRegistry: SequenceRegistryService | undefined,
  sequenceKey: string,
  fallbackPrefix: string,
  organizationUnitId?: number | null,
): Promise<string> {
  const registry = sequenceRegistry ?? defaultSequenceRegistry;
  try {
    const generated = await registry.nextCode(
      sequenceKey,
      organizationUnitId ? { organizationUnitId } : undefined,
    );
    return generated.code;
  } catch {
    return `${fallbackPrefix}-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  }
}

export function parseProviderStatusInput(
  rawStatus: PaymentTransactionStatusCode | string | number,
): PaymentTransactionStatusCode {
  if (typeof rawStatus === 'number') {
    switch (rawStatus) {
      case PAYMENT_TRANSACTION_STATUS.PENDING:
      case PAYMENT_TRANSACTION_STATUS.PROCESSING:
      case PAYMENT_TRANSACTION_STATUS.SUCCEEDED:
      case PAYMENT_TRANSACTION_STATUS.FAILED:
      case PAYMENT_TRANSACTION_STATUS.CANCELLED:
      case PAYMENT_TRANSACTION_STATUS.EXPIRED:
      case PAYMENT_TRANSACTION_STATUS.PARTIALLY_REFUNDED:
      case PAYMENT_TRANSACTION_STATUS.REFUNDED:
        return rawStatus;
      default:
        return PAYMENT_TRANSACTION_STATUS.FAILED;
    }
  }
  const clean = String(rawStatus).trim().toUpperCase();
  switch (clean) {
    case '1':
    case 'PENDING':
      return PAYMENT_TRANSACTION_STATUS.PENDING;
    case '2':
    case 'PROCESSING':
      return PAYMENT_TRANSACTION_STATUS.PROCESSING;
    case '3':
    case 'SUCCEEDED':
    case 'SUCCESS':
    case 'PAID':
    case 'COMPLETED':
      return PAYMENT_TRANSACTION_STATUS.SUCCEEDED;
    case '4':
    case 'FAILED':
    case 'FAIL':
    case 'ERROR':
      return PAYMENT_TRANSACTION_STATUS.FAILED;
    case '5':
    case 'CANCELLED':
    case 'CANCELED':
      return PAYMENT_TRANSACTION_STATUS.CANCELLED;
    case '6':
    case 'EXPIRED':
      return PAYMENT_TRANSACTION_STATUS.EXPIRED;
    case '7':
    case 'PARTIALLY_REFUNDED':
      return PAYMENT_TRANSACTION_STATUS.PARTIALLY_REFUNDED;
    case '8':
    case 'REFUNDED':
      return PAYMENT_TRANSACTION_STATUS.REFUNDED;
    default:
      return PAYMENT_TRANSACTION_STATUS.FAILED;
  }
}

export function parseProviderStatementCsv(csvText: string): ProviderStatementRecord[] {
  const matrix = parseCsvToMatrix(csvText);
  if (matrix.length < 2) return [];

  const headerIdx = detectSpreadsheetHeaderRowIndex(matrix, [
    'paymentCode',
    'payment_code',
    'merchantOrderRef',
    'merchant_order_ref',
    'providerTransactionId',
    'provider_transaction_id',
    'status',
    'amount',
    'currency',
  ]);
  const headerRow = matrix[headerIdx] ?? [];
  const findCol = createSpreadsheetColumnFinder(headerRow);

  const paymentCodeCol = findCol(['paymentCode', 'payment_code', 'code']);
  const orderRefCol = findCol(['merchantOrderRef', 'merchant_order_ref', 'orderRef', 'orderId']);
  const providerTxCol = findCol([
    'providerTransactionId',
    'provider_transaction_id',
    'transId',
    'txId',
  ]);
  const statusCol = findCol(['status', 'state']);
  const amountCol = findCol(['amount', 'totalAmount', 'total']);
  const refundedCol = findCol(['refundedAmount', 'refunded_amount', 'refundAmount']);
  const currencyCol = findCol(['currency', 'curr']);
  const paidAtCol = findCol(['paidAt', 'paid_at', 'time']);

  const records: ProviderStatementRecord[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = matrix[i] ?? [];
    const read = (idx: number) => (idx >= 0 ? cleanSpreadsheetCell(row[idx] ?? '') : '');
    const amountRaw = read(amountCol);
    if (!amountRaw) continue;
    const amount = Number.parseInt(amountRaw, 10);
    if (!Number.isFinite(amount)) continue;

    const refundedRaw = read(refundedCol);
    const refundedAmount = refundedRaw ? Number.parseInt(refundedRaw, 10) : 0;

    records.push({
      ...(read(paymentCodeCol) ? { paymentCode: read(paymentCodeCol) } : {}),
      ...(read(orderRefCol) ? { merchantOrderRef: read(orderRefCol) } : {}),
      ...(read(providerTxCol) ? { providerTransactionId: read(providerTxCol) } : {}),
      status: read(statusCol) || 'SUCCEEDED',
      amount,
      refundedAmount: Number.isFinite(refundedAmount) ? refundedAmount : 0,
      currency: (read(currencyCol) || PAYMENT_DEFAULTS.DEFAULT_CURRENCY).toUpperCase(),
      ...(read(paidAtCol) ? { paidAt: read(paidAtCol) } : {}),
    });
  }

  return records;
}

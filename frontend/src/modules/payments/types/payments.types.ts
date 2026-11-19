export type PaymentDriverCode = 'sandbox' | 'vnpay' | 'momo' | 'stripe';
export type PaymentEnvironment = 'SANDBOX' | 'PRODUCTION';
export type PaymentReconciliationSource = 'LIVE_QUERY' | 'STATEMENT';
export type PaymentReconciliationResolveAction = 'SYNC_FROM_PROVIDER' | 'MARK_RESOLVED' | 'IGNORE';

export interface PaymentDriverMetadata {
  readonly driverCode: PaymentDriverCode;
  readonly displayName: string;
  readonly description: string;
  readonly supportsPartialRefund: boolean;
  readonly supportedCurrencies: readonly string[];
  readonly requiredConfigFields: readonly string[];
  readonly requiredSecretFields: readonly string[];
}

export interface PaymentProviderItem {
  readonly id: number;
  readonly providerCode: string;
  readonly driverCode: PaymentDriverCode;
  readonly displayName: string;
  readonly description: string | null;
  readonly status: number;
  readonly statusName: string;
  readonly isEnabled: boolean;
  readonly isDefault: boolean;
  readonly environment: PaymentEnvironment;
  readonly supportsPartialRefund: boolean;
  readonly allowedCurrencies: readonly string[];
  readonly config: Record<string, unknown>;
  readonly secretHint: string | null;
  readonly configuredSecretKeys: readonly string[];
  readonly lastSuccessAt: string | null;
  readonly lastErrorAt: string | null;
  readonly lastErrorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PaymentRefundItem {
  readonly id: number;
  readonly refundCode: string;
  readonly paymentTransactionId: number;
  readonly paymentCode: string;
  readonly providerCode: string;
  readonly idempotencyKey: string;
  readonly refundType: 'FULL' | 'PARTIAL';
  readonly amount: number;
  readonly currency: string;
  readonly status: number;
  readonly statusName: string;
  readonly providerRefundId: string | null;
  readonly reason: string | null;
  readonly refundedAt: string | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly createdAt: string;
}

export interface PaymentCallbackItem {
  readonly id: number;
  readonly callbackUid: string;
  readonly providerId: number | null;
  readonly providerCode: string;
  readonly paymentTransactionId: number | null;
  readonly paymentCode: string | null;
  readonly providerEventId: string | null;
  readonly providerTransactionId: string | null;
  readonly httpMethod: string;
  readonly verificationStatus: number;
  readonly verificationStatusName: string;
  readonly signatureValid: boolean;
  readonly reportedStatus: number | null;
  readonly reportedStatusName: string | null;
  readonly reportedAmount: number | null;
  readonly reportedCurrency: string | null;
  readonly payloadSha256: string;
  readonly headers: Record<string, string>;
  readonly payload: Record<string, unknown>;
  readonly rejectionReason: string | null;
  readonly sourceIpMasked: string | null;
  readonly processedAt: string | null;
  readonly createdAt: string;
}

export interface PaymentTransactionItem {
  readonly id: number;
  readonly paymentCode: string;
  readonly idempotencyKey: string;
  readonly providerId: number;
  readonly providerCode: string;
  readonly driverCode: PaymentDriverCode;
  readonly providerTransactionId: string | null;
  readonly merchantOrderRef: string;
  readonly amount: number;
  readonly refundedAmount: number;
  readonly refundableAmount: number;
  readonly currency: string;
  readonly status: number;
  readonly statusName: string;
  readonly description: string | null;
  readonly checkoutUrl: string | null;
  readonly qrPayload: string | null;
  readonly paidAt: string | null;
  readonly expiredAt: string | null;
  readonly lastCallbackAt: string | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly refunds?: readonly PaymentRefundItem[];
  readonly callbacks?: readonly PaymentCallbackItem[];
}

export interface CreatePaymentResult {
  readonly idempotentReplay: boolean;
  readonly transaction: PaymentTransactionItem;
}

export interface RefundPaymentResult {
  readonly idempotentReplay: boolean;
  readonly refund: PaymentRefundItem;
  readonly transaction: PaymentTransactionItem;
}

export interface ReceivePaymentCallbackResult {
  readonly accepted: boolean;
  readonly duplicate: boolean;
  readonly verificationStatus: number;
  readonly verificationStatusName: string;
  readonly callbackId: number | null;
  readonly callbackUid: string | null;
  readonly transaction: PaymentTransactionItem | null;
}

export interface PaymentReconciliationLineItem {
  readonly id: number;
  readonly reconciliationId: number;
  readonly providerCode: string;
  readonly paymentTransactionId: number | null;
  readonly paymentCode: string | null;
  readonly merchantOrderRef: string | null;
  readonly providerTransactionId: string | null;
  readonly discrepancyStatus: number;
  readonly discrepancyStatusName: string;
  readonly resolutionStatus: number;
  readonly resolutionStatusName: string;
  readonly internalStatus: number | null;
  readonly internalStatusName: string | null;
  readonly providerStatus: number | null;
  readonly providerStatusName: string | null;
  readonly internalAmount: number | null;
  readonly providerAmount: number | null;
  readonly internalRefundedAmount: number | null;
  readonly providerRefundedAmount: number | null;
  readonly currency: string | null;
  readonly diffDetails: Record<string, unknown>;
  readonly resolutionNote: string | null;
  readonly resolvedBy: number | null;
  readonly resolvedAt: string | null;
  readonly createdAt: string;
}

export interface PaymentReconciliationItem {
  readonly id: number;
  readonly reconciliationCode: string;
  readonly providerCode: string;
  readonly sourceMode: PaymentReconciliationSource;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: number;
  readonly statusName: string;
  readonly totalInternalCount: number;
  readonly totalProviderCount: number;
  readonly matchedCount: number;
  readonly mismatchCount: number;
  readonly missingAtProviderCount: number;
  readonly missingInternallyCount: number;
  readonly internalTotalAmount: number;
  readonly providerTotalAmount: number;
  readonly amountDifference: number;
  readonly currency: string | null;
  readonly summary: Record<string, unknown>;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly items?: readonly PaymentReconciliationLineItem[];
}

const ZERO_DECIMAL_CURRENCIES = new Set(['VND', 'JPY', 'KRW']);

export function formatMinorMoney(amount: number | null | undefined, currency?: string | null): string {
  if (amount === null || amount === undefined) return '—';
  const curr = (currency || 'VND').toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(curr) || curr === 'MULTI') {
    return `${amount.toLocaleString('vi-VN')} ${curr}`;
  }
  return `${(amount / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${curr}`;
}

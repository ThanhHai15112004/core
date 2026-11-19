import type {
  PaymentCallbackStatusCode,
  PaymentDriverCode,
  PaymentEnvironment,
  PaymentProviderStatusCode,
  PaymentReconciliationDiscrepancyCode,
  PaymentReconciliationResolutionCode,
  PaymentReconciliationResolveAction,
  PaymentReconciliationRunStatusCode,
  PaymentReconciliationSource,
  PaymentRefundStatusCode,
  PaymentRefundType,
  PaymentTransactionStatusCode,
} from '../enum/payments.enum.js';

export interface PaymentRuntimeConfig {
  readonly defaultCurrency: string;
  readonly defaultExpirySeconds: number;
  readonly callbackToleranceSec: number;
  readonly maxStoredPayloadBytes: number;
  readonly recordRejectedCallbacks: boolean;
  readonly reconcileMaxLiveQueries: number;
}

export interface PaymentCustomerInfo {
  readonly name?: string | undefined;
  readonly email?: string | undefined;
  readonly phone?: string | undefined;
  readonly ipAddress?: string | undefined;
}

export interface CreatePaymentInput {
  readonly providerCode?: string | undefined;
  readonly idempotencyKey?: string | undefined;
  readonly merchantOrderRef: string;
  readonly amount: number;
  readonly currency?: string | undefined;
  readonly description?: string | undefined;
  readonly returnUrl?: string | undefined;
  readonly cancelUrl?: string | undefined;
  readonly locale?: string | undefined;
  readonly expiresInSeconds?: number | undefined;
  readonly customer?: PaymentCustomerInfo | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
  readonly organizationUnitId?: number | null | undefined;
}

export interface RefundPaymentInput {
  readonly idempotencyKey?: string | undefined;
  readonly amount?: number | undefined;
  readonly reason?: string | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface SimulatePaymentCallbackInput {
  readonly status?: PaymentTransactionStatusCode | undefined;
  readonly amount?: number | undefined;
  readonly currency?: string | undefined;
  readonly eventId?: string | undefined;
  readonly tamperSignature?: boolean | undefined;
  readonly failureCode?: string | undefined;
  readonly failureMessage?: string | undefined;
}

export interface ListPaymentTransactionsInput {
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: 'exact' | 'estimated' | 'none' | undefined;
  readonly providerCode?: string | undefined;
  readonly status?: PaymentTransactionStatusCode | undefined;
  readonly currency?: string | undefined;
  readonly merchantOrderRef?: string | undefined;
  readonly search?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface ReceivePaymentCallbackInput {
  readonly providerCode: string;
  readonly httpMethod: string;
  readonly rawBody: string;
  readonly parsedBody?: unknown;
  readonly query?: Record<string, unknown> | undefined;
  readonly headers?: Record<string, unknown> | undefined;
  readonly sourceIp?: string | undefined;
  readonly nowSec?: number | undefined;
}

export interface PaymentDriverMetadata {
  readonly driverCode: PaymentDriverCode;
  readonly displayName: string;
  readonly description: string;
  readonly supportsPartialRefund: boolean;
  readonly supportedCurrencies: readonly string[];
  readonly requiredConfigFields: readonly string[];
  readonly requiredSecretFields: readonly string[];
}

export interface PaymentAdapterResolvedConfig {
  readonly providerId: number;
  readonly providerCode: string;
  readonly driverCode: PaymentDriverCode;
  readonly environment: PaymentEnvironment;
  readonly supportsPartialRefund: boolean;
  readonly allowedCurrencies: readonly string[];
  readonly config: Record<string, unknown>;
  readonly secrets: Record<string, string>;
  readonly callbackToleranceSec: number;
}

export interface AdapterCreatePaymentParams {
  readonly config: PaymentAdapterResolvedConfig;
  readonly paymentCode: string;
  readonly idempotencyKey: string;
  readonly merchantOrderRef: string;
  readonly amount: number;
  readonly currency: string;
  readonly description: string;
  readonly returnUrl: string | null;
  readonly cancelUrl: string | null;
  readonly locale: string;
  readonly expiresAt: Date;
  readonly customer: PaymentCustomerInfo | null;
  readonly metadata: Record<string, unknown>;
}

export interface AdapterCreatePaymentResult {
  readonly providerTransactionId: string | null;
  readonly status: PaymentTransactionStatusCode;
  readonly checkoutUrl: string | null;
  readonly qrPayload: string | null;
  readonly rawResponse: Record<string, unknown>;
}

export interface AdapterVerifyCallbackParams {
  readonly config: PaymentAdapterResolvedConfig;
  readonly httpMethod: string;
  readonly rawBody: string;
  readonly parsedBody: unknown;
  readonly query: Record<string, unknown>;
  readonly headers: Record<string, string>;
  readonly nowSec?: number | undefined;
}

export interface VerifiedPaymentCallback {
  readonly signatureValid: boolean;
  readonly rejectionCode: string | null;
  readonly rejectionReason: string | null;
  readonly providerEventId: string | null;
  readonly providerTransactionId: string | null;
  readonly paymentCode: string | null;
  readonly merchantOrderRef: string | null;
  readonly reportedStatus: PaymentTransactionStatusCode | null;
  readonly reportedAmount: number | null;
  readonly reportedCurrency: string | null;
  readonly paidAt: Date | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly normalizedPayload: Record<string, unknown>;
  readonly ackBody: Record<string, unknown>;
}

export interface AdapterRefundParams {
  readonly config: PaymentAdapterResolvedConfig;
  readonly paymentCode: string;
  readonly refundCode: string;
  readonly idempotencyKey: string;
  readonly refundType: PaymentRefundType;
  readonly refundAmount: number;
  readonly originalAmount: number;
  readonly currency: string;
  readonly providerTransactionId: string | null;
  readonly merchantOrderRef: string;
  readonly paidAt: Date | null;
  readonly reason: string | null;
  readonly actorIdentifier: string;
}

export interface AdapterRefundResult {
  readonly status: PaymentRefundStatusCode;
  readonly providerRefundId: string | null;
  readonly refundedAt: Date | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly rawResponse: Record<string, unknown>;
}

export interface AdapterQueryTransactionParams {
  readonly config: PaymentAdapterResolvedConfig;
  readonly paymentCode: string;
  readonly merchantOrderRef: string;
  readonly providerTransactionId: string | null;
  readonly amount: number;
  readonly currency: string;
  readonly createdAt: Date;
}

export interface ProviderTransactionSnapshot {
  readonly providerCode: string;
  readonly paymentCode: string | null;
  readonly merchantOrderRef: string | null;
  readonly providerTransactionId: string | null;
  readonly status: PaymentTransactionStatusCode;
  readonly amount: number;
  readonly refundedAmount: number;
  readonly currency: string;
  readonly paidAt: Date | null;
  readonly rawSnapshot: Record<string, unknown>;
}

export interface ProviderStatementRecord {
  readonly paymentCode?: string | undefined;
  readonly merchantOrderRef?: string | undefined;
  readonly providerTransactionId?: string | undefined;
  readonly status: PaymentTransactionStatusCode | string | number;
  readonly amount: number;
  readonly refundedAmount?: number | undefined;
  readonly currency: string;
  readonly paidAt?: string | undefined;
  readonly raw?: Record<string, unknown> | undefined;
}

export interface RunReconciliationInput {
  readonly providerCode: string;
  readonly sourceMode: PaymentReconciliationSource;
  readonly periodStart: string | Date;
  readonly periodEnd: string | Date;
  readonly statementItems?: readonly ProviderStatementRecord[] | undefined;
  readonly statementCsv?: string | undefined;
}

export interface ResolveReconciliationItemInput {
  readonly action: PaymentReconciliationResolveAction;
  readonly note?: string | undefined;
}

export interface PaymentProviderView {
  readonly id: number;
  readonly providerCode: string;
  readonly driverCode: PaymentDriverCode;
  readonly displayName: string;
  readonly description: string | null;
  readonly status: PaymentProviderStatusCode;
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
  readonly createdBy: number | null;
  readonly updatedBy: number | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PaymentRefundView {
  readonly id: number;
  readonly refundCode: string;
  readonly paymentTransactionId: number;
  readonly paymentCode: string;
  readonly providerCode: string;
  readonly idempotencyKey: string;
  readonly refundType: PaymentRefundType;
  readonly amount: number;
  readonly currency: string;
  readonly status: PaymentRefundStatusCode;
  readonly statusName: string;
  readonly providerRefundId: string | null;
  readonly reason: string | null;
  readonly metadata: Record<string, unknown>;
  readonly providerRawResponse: Record<string, unknown>;
  readonly refundedAt: string | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly createdBy: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PaymentCallbackView {
  readonly id: number;
  readonly callbackUid: string;
  readonly providerId: number | null;
  readonly providerCode: string;
  readonly paymentTransactionId: number | null;
  readonly paymentCode: string | null;
  readonly providerEventId: string | null;
  readonly providerTransactionId: string | null;
  readonly httpMethod: string;
  readonly verificationStatus: PaymentCallbackStatusCode;
  readonly verificationStatusName: string;
  readonly signatureValid: boolean;
  readonly reportedStatus: PaymentTransactionStatusCode | null;
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

export interface PaymentTransactionView {
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
  readonly status: PaymentTransactionStatusCode;
  readonly statusName: string;
  readonly description: string | null;
  readonly checkoutUrl: string | null;
  readonly qrPayload: string | null;
  readonly returnUrl: string | null;
  readonly cancelUrl: string | null;
  readonly customer: PaymentCustomerInfo | null;
  readonly metadata: Record<string, unknown>;
  readonly providerRawResponse: Record<string, unknown>;
  readonly paidAt: string | null;
  readonly expiredAt: string | null;
  readonly lastCallbackAt: string | null;
  readonly failureCode: string | null;
  readonly failureMessage: string | null;
  readonly organizationUnitId: number | null;
  readonly createdBy: number | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly refunds?: readonly PaymentRefundView[] | undefined;
  readonly callbacks?: readonly PaymentCallbackView[] | undefined;
}

export interface CreatePaymentResult {
  readonly idempotentReplay: boolean;
  readonly transaction: PaymentTransactionView;
}

export interface RefundPaymentResult {
  readonly idempotentReplay: boolean;
  readonly refund: PaymentRefundView;
  readonly transaction: PaymentTransactionView;
}

export interface ReceivePaymentCallbackResult {
  readonly accepted: boolean;
  readonly duplicate: boolean;
  readonly verificationStatus: PaymentCallbackStatusCode;
  readonly verificationStatusName: string;
  readonly callbackId: number | null;
  readonly callbackUid: string | null;
  readonly transaction: PaymentTransactionView | null;
  readonly ackBody: Record<string, unknown>;
}

export interface PaymentReconciliationItemView {
  readonly id: number;
  readonly reconciliationId: number;
  readonly providerCode: string;
  readonly paymentTransactionId: number | null;
  readonly paymentCode: string | null;
  readonly merchantOrderRef: string | null;
  readonly providerTransactionId: string | null;
  readonly discrepancyStatus: PaymentReconciliationDiscrepancyCode;
  readonly discrepancyStatusName: string;
  readonly resolutionStatus: PaymentReconciliationResolutionCode;
  readonly resolutionStatusName: string;
  readonly internalStatus: PaymentTransactionStatusCode | null;
  readonly internalStatusName: string | null;
  readonly providerStatus: PaymentTransactionStatusCode | null;
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

export interface PaymentReconciliationView {
  readonly id: number;
  readonly reconciliationCode: string;
  readonly providerCode: string;
  readonly sourceMode: PaymentReconciliationSource;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: PaymentReconciliationRunStatusCode;
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
  readonly createdBy: number | null;
  readonly createdAt: string;
  readonly items?: readonly PaymentReconciliationItemView[] | undefined;
}

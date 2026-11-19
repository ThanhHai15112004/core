import {
  safeJsonParse,
  safeJsonParseObject,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import {
  getPaymentCallbackStatusName,
  getPaymentDiscrepancyName,
  getPaymentProviderStatusName,
  getPaymentRefundStatusName,
  getPaymentResolutionStatusName,
  getPaymentTransactionStatusName,
} from '../enum/payments.enum.js';
import type { PaymentCallbackEntity } from '../entities/payment-callback.entity.js';
import type { PaymentProviderEntity } from '../entities/payment-provider.entity.js';
import type { PaymentReconciliationItemEntity } from '../entities/payment-reconciliation-item.entity.js';
import type { PaymentReconciliationEntity } from '../entities/payment-reconciliation.entity.js';
import type { PaymentRefundEntity } from '../entities/payment-refund.entity.js';
import type { PaymentTransactionEntity } from '../entities/payment-transaction.entity.js';
import type {
  PaymentCallbackView,
  PaymentCustomerInfo,
  PaymentProviderView,
  PaymentReconciliationItemView,
  PaymentReconciliationView,
  PaymentRefundView,
  PaymentTransactionView,
} from '../types/payments.types.js';

function toIsoOrNull(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val.toISOString();
  const parsed = new Date(val);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export class PaymentResponseMapper {
  public static toProviderView(
    entity: PaymentProviderEntity,
    configuredSecretKeys: readonly string[] = [],
  ): PaymentProviderView {
    return {
      id: Number(entity.id),
      providerCode: entity.providerCode,
      driverCode: entity.driverCode,
      displayName: entity.displayName,
      description: entity.description ?? null,
      status: entity.status,
      statusName: getPaymentProviderStatusName(entity.status),
      isEnabled: Boolean(entity.isEnabled),
      isDefault: Boolean(entity.isDefault),
      environment: entity.environment,
      supportsPartialRefund: Boolean(entity.supportsPartialRefund),
      allowedCurrencies: safeJsonParseStringArray(entity.allowedCurrenciesJson),
      config: safeJsonParseObject<Record<string, unknown>>(entity.configJson, {}),
      secretHint: entity.secretHint ?? null,
      configuredSecretKeys,
      lastSuccessAt: toIsoOrNull(entity.lastSuccessAt),
      lastErrorAt: toIsoOrNull(entity.lastErrorAt),
      lastErrorCode: entity.lastErrorCode ?? null,
      createdBy:
        entity.createdBy !== null && entity.createdBy !== undefined
          ? Number(entity.createdBy)
          : null,
      updatedBy:
        entity.updatedBy !== null && entity.updatedBy !== undefined
          ? Number(entity.updatedBy)
          : null,
      version: Number(entity.version ?? 1),
      createdAt: toIsoOrNull(entity.createdAt) ?? new Date().toISOString(),
      updatedAt: toIsoOrNull(entity.updatedAt) ?? new Date().toISOString(),
    };
  }

  public static toRefundView(entity: PaymentRefundEntity): PaymentRefundView {
    return {
      id: Number(entity.id),
      refundCode: entity.refundCode,
      paymentTransactionId: Number(entity.paymentTransactionId),
      paymentCode: entity.paymentCode,
      providerCode: entity.providerCode,
      idempotencyKey: entity.idempotencyKey,
      refundType: entity.refundType,
      amount: Number(entity.amount),
      currency: entity.currency,
      status: entity.status,
      statusName: getPaymentRefundStatusName(entity.status),
      providerRefundId: entity.providerRefundId ?? null,
      reason: entity.reason ?? null,
      metadata: safeJsonParseObject<Record<string, unknown>>(entity.metadataJson, {}),
      providerRawResponse: safeJsonParseObject<Record<string, unknown>>(
        entity.providerRawResponseRedactedJson,
        {},
      ),
      refundedAt: toIsoOrNull(entity.refundedAt),
      failureCode: entity.failureCode ?? null,
      failureMessage: entity.failureMessage ?? null,
      createdBy:
        entity.createdBy !== null && entity.createdBy !== undefined
          ? Number(entity.createdBy)
          : null,
      createdAt: toIsoOrNull(entity.createdAt) ?? new Date().toISOString(),
      updatedAt: toIsoOrNull(entity.updatedAt) ?? new Date().toISOString(),
    };
  }

  public static toCallbackView(entity: PaymentCallbackEntity): PaymentCallbackView {
    return {
      id: Number(entity.id),
      callbackUid: entity.callbackUid,
      providerId:
        entity.providerId !== null && entity.providerId !== undefined
          ? Number(entity.providerId)
          : null,
      providerCode: entity.providerCode,
      paymentTransactionId:
        entity.paymentTransactionId !== null && entity.paymentTransactionId !== undefined
          ? Number(entity.paymentTransactionId)
          : null,
      paymentCode: entity.paymentCode ?? null,
      providerEventId: entity.providerEventId ?? null,
      providerTransactionId: entity.providerTransactionId ?? null,
      httpMethod: entity.httpMethod,
      verificationStatus: entity.verificationStatus,
      verificationStatusName: getPaymentCallbackStatusName(entity.verificationStatus),
      signatureValid: Boolean(entity.signatureValid),
      reportedStatus: entity.reportedStatus ?? null,
      reportedStatusName:
        entity.reportedStatus !== null && entity.reportedStatus !== undefined
          ? getPaymentTransactionStatusName(entity.reportedStatus)
          : null,
      reportedAmount:
        entity.reportedAmount !== null && entity.reportedAmount !== undefined
          ? Number(entity.reportedAmount)
          : null,
      reportedCurrency: entity.reportedCurrency ?? null,
      payloadSha256: entity.payloadSha256,
      headers: safeJsonParseObject<Record<string, string>>(entity.headersRedactedJson, {}),
      payload: safeJsonParseObject<Record<string, unknown>>(entity.payloadRedactedJson, {}),
      rejectionReason: entity.rejectionReason ?? null,
      sourceIpMasked: entity.sourceIpMasked ?? null,
      processedAt: toIsoOrNull(entity.processedAt),
      createdAt: toIsoOrNull(entity.createdAt) ?? new Date().toISOString(),
    };
  }

  public static toTransactionView(
    entity: PaymentTransactionEntity,
    options?: {
      readonly refunds?: readonly PaymentRefundEntity[] | undefined;
      readonly callbacks?: readonly PaymentCallbackEntity[] | undefined;
    },
  ): PaymentTransactionView {
    const amount = Number(entity.amount);
    const refundedAmount = Number(entity.refundedAmount ?? 0);
    return {
      id: Number(entity.id),
      paymentCode: entity.paymentCode,
      idempotencyKey: entity.idempotencyKey,
      providerId: Number(entity.providerId),
      providerCode: entity.providerCode,
      driverCode: entity.driverCode,
      providerTransactionId: entity.providerTransactionId ?? null,
      merchantOrderRef: entity.merchantOrderRef,
      amount,
      refundedAmount,
      refundableAmount: Math.max(0, amount - refundedAmount),
      currency: entity.currency,
      status: entity.status,
      statusName: getPaymentTransactionStatusName(entity.status),
      description: entity.description ?? null,
      checkoutUrl: entity.checkoutUrl ?? null,
      qrPayload: entity.qrPayload ?? null,
      returnUrl: entity.returnUrl ?? null,
      cancelUrl: entity.cancelUrl ?? null,
      customer: entity.customerJson
        ? safeJsonParse<PaymentCustomerInfo>(entity.customerJson, null)
        : null,
      metadata: safeJsonParseObject<Record<string, unknown>>(entity.metadataJson, {}),
      providerRawResponse: safeJsonParseObject<Record<string, unknown>>(
        entity.providerRawResponseRedactedJson,
        {},
      ),
      paidAt: toIsoOrNull(entity.paidAt),
      expiredAt: toIsoOrNull(entity.expiredAt),
      lastCallbackAt: toIsoOrNull(entity.lastCallbackAt),
      failureCode: entity.failureCode ?? null,
      failureMessage: entity.failureMessage ?? null,
      organizationUnitId:
        entity.organizationUnitId !== null && entity.organizationUnitId !== undefined
          ? Number(entity.organizationUnitId)
          : null,
      createdBy:
        entity.createdBy !== null && entity.createdBy !== undefined
          ? Number(entity.createdBy)
          : null,
      version: Number(entity.version ?? 1),
      createdAt: toIsoOrNull(entity.createdAt) ?? new Date().toISOString(),
      updatedAt: toIsoOrNull(entity.updatedAt) ?? new Date().toISOString(),
      ...(options?.refunds
        ? { refunds: options.refunds.map((r) => PaymentResponseMapper.toRefundView(r)) }
        : {}),
      ...(options?.callbacks
        ? { callbacks: options.callbacks.map((c) => PaymentResponseMapper.toCallbackView(c)) }
        : {}),
    };
  }

  public static toReconciliationItemView(
    entity: PaymentReconciliationItemEntity,
  ): PaymentReconciliationItemView {
    return {
      id: Number(entity.id),
      reconciliationId: Number(entity.reconciliationId),
      providerCode: entity.providerCode,
      paymentTransactionId:
        entity.paymentTransactionId !== null && entity.paymentTransactionId !== undefined
          ? Number(entity.paymentTransactionId)
          : null,
      paymentCode: entity.paymentCode ?? null,
      merchantOrderRef: entity.merchantOrderRef ?? null,
      providerTransactionId: entity.providerTransactionId ?? null,
      discrepancyStatus: entity.discrepancyStatus,
      discrepancyStatusName: getPaymentDiscrepancyName(entity.discrepancyStatus),
      resolutionStatus: entity.resolutionStatus,
      resolutionStatusName: getPaymentResolutionStatusName(entity.resolutionStatus),
      internalStatus: entity.internalStatus ?? null,
      internalStatusName:
        entity.internalStatus !== null && entity.internalStatus !== undefined
          ? getPaymentTransactionStatusName(entity.internalStatus)
          : null,
      providerStatus: entity.providerStatus ?? null,
      providerStatusName:
        entity.providerStatus !== null && entity.providerStatus !== undefined
          ? getPaymentTransactionStatusName(entity.providerStatus)
          : null,
      internalAmount:
        entity.internalAmount !== null && entity.internalAmount !== undefined
          ? Number(entity.internalAmount)
          : null,
      providerAmount:
        entity.providerAmount !== null && entity.providerAmount !== undefined
          ? Number(entity.providerAmount)
          : null,
      internalRefundedAmount:
        entity.internalRefundedAmount !== null && entity.internalRefundedAmount !== undefined
          ? Number(entity.internalRefundedAmount)
          : null,
      providerRefundedAmount:
        entity.providerRefundedAmount !== null && entity.providerRefundedAmount !== undefined
          ? Number(entity.providerRefundedAmount)
          : null,
      currency: entity.currency ?? null,
      diffDetails: safeJsonParseObject<Record<string, unknown>>(entity.diffDetailsJson, {}),
      resolutionNote: entity.resolutionNote ?? null,
      resolvedBy:
        entity.resolvedBy !== null && entity.resolvedBy !== undefined
          ? Number(entity.resolvedBy)
          : null,
      resolvedAt: toIsoOrNull(entity.resolvedAt),
      createdAt: toIsoOrNull(entity.createdAt) ?? new Date().toISOString(),
    };
  }

  public static toReconciliationView(
    entity: PaymentReconciliationEntity,
    items?: readonly PaymentReconciliationItemEntity[],
  ): PaymentReconciliationView {
    const runStatusName =
      entity.status === 1 ? 'RUNNING' : entity.status === 2 ? 'COMPLETED' : 'FAILED';
    return {
      id: Number(entity.id),
      reconciliationCode: entity.reconciliationCode,
      providerCode: entity.providerCode,
      sourceMode: entity.sourceMode,
      periodStart: toIsoOrNull(entity.periodStart) ?? new Date().toISOString(),
      periodEnd: toIsoOrNull(entity.periodEnd) ?? new Date().toISOString(),
      status: entity.status,
      statusName: runStatusName,
      totalInternalCount: Number(entity.totalInternalCount ?? 0),
      totalProviderCount: Number(entity.totalProviderCount ?? 0),
      matchedCount: Number(entity.matchedCount ?? 0),
      mismatchCount: Number(entity.mismatchCount ?? 0),
      missingAtProviderCount: Number(entity.missingAtProviderCount ?? 0),
      missingInternallyCount: Number(entity.missingInternallyCount ?? 0),
      internalTotalAmount: Number(entity.internalTotalAmount ?? 0),
      providerTotalAmount: Number(entity.providerTotalAmount ?? 0),
      amountDifference: Number(entity.amountDifference ?? 0),
      currency: entity.currency ?? null,
      summary: safeJsonParseObject<Record<string, unknown>>(entity.summaryJson, {}),
      startedAt: toIsoOrNull(entity.startedAt) ?? new Date().toISOString(),
      completedAt: toIsoOrNull(entity.completedAt),
      createdBy:
        entity.createdBy !== null && entity.createdBy !== undefined
          ? Number(entity.createdBy)
          : null,
      createdAt: toIsoOrNull(entity.createdAt) ?? new Date().toISOString(),
      ...(items
        ? { items: items.map((item) => PaymentResponseMapper.toReconciliationItemView(item)) }
        : {}),
    };
  }
}

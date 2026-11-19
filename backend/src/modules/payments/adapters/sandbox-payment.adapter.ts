import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { safeJsonParseObject } from '@packages/kernel/index.js';
import type { IPaymentProviderAdapter } from '../contracts/index.js';
import {
  PAYMENT_DEFAULTS,
  PAYMENT_DRIVER_CODE,
  PAYMENT_REFUND_STATUS,
  PAYMENT_TRANSACTION_STATUS,
  type PaymentTransactionStatusCode,
} from '../enum/payments.enum.js';
import { parseProviderStatusInput } from '../helpers/payment-config.helper.js';
import {
  hmacHex,
  isTimestampWithinTolerance,
  parseTimestampedSignatureHeader,
  verifyHmacHex,
} from '../helpers/payment-signature.helper.js';
import type {
  AdapterCreatePaymentParams,
  AdapterCreatePaymentResult,
  AdapterQueryTransactionParams,
  AdapterRefundParams,
  AdapterRefundResult,
  AdapterVerifyCallbackParams,
  PaymentDriverMetadata,
  ProviderTransactionSnapshot,
  VerifiedPaymentCallback,
} from '../types/payments.types.js';

@Injectable()
export class SandboxPaymentAdapter implements IPaymentProviderAdapter {
  public readonly driverCode = PAYMENT_DRIVER_CODE.SANDBOX;

  public getMetadata(): PaymentDriverMetadata {
    return {
      driverCode: this.driverCode,
      displayName: 'Sandbox Payment Gateway',
      description:
        'Cổng thanh toán nội bộ chuẩn hóa cho kiểm thử toàn trình (tạo GD, callback HMAC-SHA256, hoàn tiền toàn phần/một phần và đối soát).',
      supportsPartialRefund: true,
      supportedCurrencies: ['VND', 'USD', 'EUR', 'SGD'],
      requiredConfigFields: [],
      requiredSecretFields: ['webhookSecret'],
    };
  }

  public static signCallbackPayload(params: {
    readonly rawBody: string;
    readonly webhookSecret: string;
    readonly timestampSec?: number | undefined;
  }): { readonly timestampSec: number; readonly header: string } {
    const timestampSec = Math.trunc(params.timestampSec ?? Math.floor(Date.now() / 1000));
    const digest = hmacHex('sha256', params.webhookSecret, `${timestampSec}.${params.rawBody}`);
    return {
      timestampSec,
      header: `t=${timestampSec},v1=${digest}`,
    };
  }

  public async createPayment(
    params: AdapterCreatePaymentParams,
  ): Promise<AdapterCreatePaymentResult> {
    const providerTransactionId = `sbx_tx_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const baseCheckout =
      (typeof params.config.config['checkoutBaseUrl'] === 'string' &&
        params.config.config['checkoutBaseUrl'].trim()) ||
      params.returnUrl ||
      PAYMENT_DEFAULTS.SANDBOX_CHECKOUT_BASE_URL;

    const checkoutUrl = new URL(baseCheckout);
    checkoutUrl.searchParams.set('paymentCode', params.paymentCode);
    checkoutUrl.searchParams.set('providerTxId', providerTransactionId);
    checkoutUrl.searchParams.set('amount', String(params.amount));
    checkoutUrl.searchParams.set('currency', params.currency);

    return {
      providerTransactionId,
      status: PAYMENT_TRANSACTION_STATUS.PENDING,
      checkoutUrl: checkoutUrl.toString(),
      qrPayload: `SANDBOX_QR:${params.paymentCode}:${params.amount}:${params.currency}`,
      rawResponse: {
        driver: this.driverCode,
        providerTransactionId,
        paymentCode: params.paymentCode,
        merchantOrderRef: params.merchantOrderRef,
        amount: params.amount,
        currency: params.currency,
        simulated: true,
      },
    };
  }

  public async verifyCallback(
    params: AdapterVerifyCallbackParams,
  ): Promise<VerifiedPaymentCallback> {
    const secret =
      params.config.secrets['webhookSecret'] ??
      params.config.secrets['secretKey'] ??
      'sandbox-default-webhook-secret';

    const sigHeader = params.headers['x-sandbox-signature'] ?? params.headers['x-signature'] ?? '';
    const parsedSig = parseTimestampedSignatureHeader(sigHeader);
    const bodyObj =
      params.parsedBody &&
      typeof params.parsedBody === 'object' &&
      !Array.isArray(params.parsedBody)
        ? (params.parsedBody as Record<string, unknown>)
        : safeJsonParseObject<Record<string, unknown>>(params.rawBody, {});

    if (!parsedSig.timestampSec || parsedSig.signatures.length === 0) {
      return this.invalidCallbackResult(
        'MISSING_SIGNATURE',
        'Missing x-sandbox-signature header (expected t=...,v1=...)',
        bodyObj,
      );
    }

    if (
      !isTimestampWithinTolerance({
        timestampSec: parsedSig.timestampSec,
        toleranceSec: params.config.callbackToleranceSec,
        nowSec: params.nowSec,
      })
    ) {
      return this.invalidCallbackResult(
        'TIMESTAMP_EXPIRED',
        'Sandbox callback signature timestamp is outside tolerance window',
        bodyObj,
      );
    }

    const signedContent = `${parsedSig.timestampSec}.${params.rawBody}`;
    const valid = parsedSig.signatures.some((sig) =>
      verifyHmacHex({
        algorithm: 'sha256',
        secret,
        data: signedContent,
        expectedHex: sig,
      }),
    );

    if (!valid) {
      return this.invalidCallbackResult(
        'SIGNATURE_MISMATCH',
        'Sandbox HMAC-SHA256 callback signature verification failed',
        bodyObj,
      );
    }

    const reportedStatus =
      bodyObj['status'] !== undefined
        ? parseProviderStatusInput(
            bodyObj['status'] as PaymentTransactionStatusCode | string | number,
          )
        : PAYMENT_TRANSACTION_STATUS.SUCCEEDED;
    const rawAmount = bodyObj['amount'];
    const reportedAmount =
      typeof rawAmount === 'number' && Number.isFinite(rawAmount)
        ? Math.trunc(rawAmount)
        : typeof rawAmount === 'string' && /^\d+$/.test(rawAmount.trim())
          ? Number.parseInt(rawAmount.trim(), 10)
          : null;
    const reportedCurrency =
      typeof bodyObj['currency'] === 'string' && bodyObj['currency'].trim()
        ? bodyObj['currency'].trim().toUpperCase()
        : null;

    const paidAt =
      typeof bodyObj['paidAt'] === 'string' && !Number.isNaN(Date.parse(bodyObj['paidAt']))
        ? new Date(bodyObj['paidAt'])
        : reportedStatus === PAYMENT_TRANSACTION_STATUS.SUCCEEDED
          ? new Date()
          : null;

    return {
      signatureValid: true,
      rejectionCode: null,
      rejectionReason: null,
      providerEventId:
        typeof bodyObj['eventId'] === 'string' && bodyObj['eventId'].trim()
          ? bodyObj['eventId'].trim()
          : null,
      providerTransactionId:
        typeof bodyObj['providerTransactionId'] === 'string' &&
        bodyObj['providerTransactionId'].trim()
          ? bodyObj['providerTransactionId'].trim()
          : null,
      paymentCode:
        typeof bodyObj['paymentCode'] === 'string' && bodyObj['paymentCode'].trim()
          ? bodyObj['paymentCode'].trim()
          : null,
      merchantOrderRef:
        typeof bodyObj['merchantOrderRef'] === 'string' && bodyObj['merchantOrderRef'].trim()
          ? bodyObj['merchantOrderRef'].trim()
          : null,
      reportedStatus,
      reportedAmount,
      reportedCurrency,
      paidAt,
      failureCode:
        typeof bodyObj['failureCode'] === 'string' ? bodyObj['failureCode'].trim() : null,
      failureMessage:
        typeof bodyObj['failureMessage'] === 'string' ? bodyObj['failureMessage'].trim() : null,
      normalizedPayload: bodyObj,
      ackBody: { received: true, driver: this.driverCode },
    };
  }

  public async refund(params: AdapterRefundParams): Promise<AdapterRefundResult> {
    const providerRefundId = `sbx_ref_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    return {
      status: PAYMENT_REFUND_STATUS.SUCCEEDED,
      providerRefundId,
      refundedAt: new Date(),
      failureCode: null,
      failureMessage: null,
      rawResponse: {
        driver: this.driverCode,
        providerRefundId,
        refundCode: params.refundCode,
        refundType: params.refundType,
        refundAmount: params.refundAmount,
        currency: params.currency,
      },
    };
  }

  public async queryTransaction(
    params: AdapterQueryTransactionParams,
  ): Promise<ProviderTransactionSnapshot | null> {
    const mockMap = params.config.config['mockProviderStates'];
    if (mockMap && typeof mockMap === 'object' && !Array.isArray(mockMap)) {
      const override = (mockMap as Record<string, unknown>)[params.paymentCode];
      if (override === null) {
        return null;
      }
      if (override && typeof override === 'object' && !Array.isArray(override)) {
        const rec = override as Record<string, unknown>;
        return {
          providerCode: params.config.providerCode,
          paymentCode: params.paymentCode,
          merchantOrderRef: params.merchantOrderRef,
          providerTransactionId:
            typeof rec['providerTransactionId'] === 'string'
              ? rec['providerTransactionId']
              : params.providerTransactionId,
          status:
            rec['status'] !== undefined
              ? parseProviderStatusInput(
                  rec['status'] as PaymentTransactionStatusCode | string | number,
                )
              : PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
          amount: typeof rec['amount'] === 'number' ? rec['amount'] : params.amount,
          refundedAmount: typeof rec['refundedAmount'] === 'number' ? rec['refundedAmount'] : 0,
          currency:
            typeof rec['currency'] === 'string'
              ? rec['currency'].trim().toUpperCase()
              : params.currency,
          paidAt: params.createdAt,
          rawSnapshot: rec,
        };
      }
    }

    return {
      providerCode: params.config.providerCode,
      paymentCode: params.paymentCode,
      merchantOrderRef: params.merchantOrderRef,
      providerTransactionId: params.providerTransactionId,
      status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
      amount: params.amount,
      refundedAmount: 0,
      currency: params.currency,
      paidAt: params.createdAt,
      rawSnapshot: {
        driver: this.driverCode,
        paymentCode: params.paymentCode,
        providerTransactionId: params.providerTransactionId,
        amount: params.amount,
        currency: params.currency,
        simulated: true,
      },
    };
  }

  private invalidCallbackResult(
    rejectionCode: string,
    rejectionReason: string,
    bodyObj: Record<string, unknown>,
  ): VerifiedPaymentCallback {
    return {
      signatureValid: false,
      rejectionCode,
      rejectionReason,
      providerEventId: typeof bodyObj['eventId'] === 'string' ? bodyObj['eventId'].trim() : null,
      providerTransactionId:
        typeof bodyObj['providerTransactionId'] === 'string'
          ? bodyObj['providerTransactionId'].trim()
          : null,
      paymentCode:
        typeof bodyObj['paymentCode'] === 'string' ? bodyObj['paymentCode'].trim() : null,
      merchantOrderRef:
        typeof bodyObj['merchantOrderRef'] === 'string' ? bodyObj['merchantOrderRef'].trim() : null,
      reportedStatus: null,
      reportedAmount: null,
      reportedCurrency: null,
      paidAt: null,
      failureCode: rejectionCode,
      failureMessage: rejectionReason,
      normalizedPayload: bodyObj,
      ackBody: { received: false, error: rejectionCode },
    };
  }
}

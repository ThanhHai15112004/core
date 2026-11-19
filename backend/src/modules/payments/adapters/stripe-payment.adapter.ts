import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BaseHttpClientProvider,
  HTTP_CLIENT_TOKEN,
  type HttpClientContract,
} from '@packages/http-client/index.js';
import { BadRequestAppException, safeJsonParseObject } from '@packages/kernel/index.js';
import type { IPaymentProviderAdapter } from '../contracts/index.js';
import {
  PAYMENT_DRIVER_CODE,
  PAYMENT_REFUND_STATUS,
  PAYMENT_REFUND_TYPE,
  PAYMENT_TRANSACTION_STATUS,
  type PaymentTransactionStatusCode,
} from '../enum/payments.enum.js';
import {
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

const STRIPE_DEFAULT_API_BASE = 'https://api.stripe.com';

@Injectable()
export class StripePaymentAdapter implements IPaymentProviderAdapter {
  public readonly driverCode = PAYMENT_DRIVER_CODE.STRIPE;
  private readonly httpClient: HttpClientContract;

  constructor(
    @Optional()
    @Inject(HTTP_CLIENT_TOKEN)
    httpClient?: HttpClientContract,
  ) {
    this.httpClient = httpClient ?? new BaseHttpClientProvider();
  }

  public getMetadata(): PaymentDriverMetadata {
    return {
      driverCode: this.driverCode,
      displayName: 'Stripe Checkout & Payments',
      description:
        'Cổng thanh toán quốc tế Stripe: tạo Checkout Session với Idempotency-Key, xác minh Stripe-Signature (`t=...,v1=...`), hoàn tiền toàn phần/một phần và đối soát.',
      supportsPartialRefund: true,
      supportedCurrencies: ['USD', 'VND', 'EUR', 'SGD', 'GBP'],
      requiredConfigFields: [],
      requiredSecretFields: ['secretKey', 'webhookSecret'],
    };
  }

  public async createPayment(
    params: AdapterCreatePaymentParams,
  ): Promise<AdapterCreatePaymentResult> {
    const secretKey = this.requireString(params.config.secrets['secretKey'], 'secretKey');
    const apiBase = this.resolveApiBase(params.config.config['apiBaseUrl']);

    const form = new URLSearchParams();
    form.set('mode', 'payment');
    form.set('success_url', params.returnUrl || 'https://localhost/payments/stripe/success');
    form.set('cancel_url', params.cancelUrl || 'https://localhost/payments/stripe/cancel');
    form.set('client_reference_id', params.paymentCode);
    form.set('metadata[paymentCode]', params.paymentCode);
    form.set('metadata[merchantOrderRef]', params.merchantOrderRef);
    form.set('line_items[0][quantity]', '1');
    form.set('line_items[0][price_data][currency]', params.currency.toLowerCase());
    form.set('line_items[0][price_data][unit_amount]', String(params.amount));
    form.set('line_items[0][price_data][product_data][name]', params.description.slice(0, 120));
    if (params.customer?.email) {
      form.set('customer_email', params.customer.email);
    }

    const res = await this.httpClient
      .forService('payment-stripe')
      .post<Record<string, unknown>>(`${apiBase}/v1/checkout/sessions`, form, {
        headers: {
          authorization: `Bearer ${secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        idempotencyKey: params.idempotencyKey,
      });

    return {
      providerTransactionId: typeof res['id'] === 'string' ? res['id'] : null,
      status: PAYMENT_TRANSACTION_STATUS.PENDING,
      checkoutUrl: typeof res['url'] === 'string' ? res['url'] : null,
      qrPayload: null,
      rawResponse: res,
    };
  }

  public async verifyCallback(
    params: AdapterVerifyCallbackParams,
  ): Promise<VerifiedPaymentCallback> {
    const webhookSecret = params.config.secrets['webhookSecret'] ?? '';
    const sigHeader = params.headers['stripe-signature'] ?? '';
    const parsedSig = parseTimestampedSignatureHeader(sigHeader);

    const event =
      params.parsedBody &&
      typeof params.parsedBody === 'object' &&
      !Array.isArray(params.parsedBody)
        ? (params.parsedBody as Record<string, unknown>)
        : safeJsonParseObject<Record<string, unknown>>(params.rawBody, {});

    const eventId = typeof event['id'] === 'string' ? event['id'].trim() : null;
    const dataObj = this.extractEventObject(event);
    const metadata =
      dataObj['metadata'] &&
      typeof dataObj['metadata'] === 'object' &&
      !Array.isArray(dataObj['metadata'])
        ? (dataObj['metadata'] as Record<string, unknown>)
        : {};
    const paymentCode =
      (typeof metadata['paymentCode'] === 'string' && metadata['paymentCode'].trim()) ||
      (typeof dataObj['client_reference_id'] === 'string' &&
        dataObj['client_reference_id'].trim()) ||
      null;
    const providerTransactionId =
      typeof dataObj['payment_intent'] === 'string' && dataObj['payment_intent'].trim()
        ? dataObj['payment_intent'].trim()
        : typeof dataObj['id'] === 'string' && dataObj['id'].trim()
          ? dataObj['id'].trim()
          : null;

    if (!webhookSecret || !parsedSig.timestampSec || parsedSig.signatures.length === 0) {
      return this.invalidCallback(
        'MISSING_STRIPE_SIGNATURE',
        'Missing Stripe-Signature header or webhookSecret',
        event,
        eventId,
        providerTransactionId,
        paymentCode,
      );
    }

    if (
      !isTimestampWithinTolerance({
        timestampSec: parsedSig.timestampSec,
        toleranceSec: params.config.callbackToleranceSec,
        nowSec: params.nowSec,
      })
    ) {
      return this.invalidCallback(
        'TIMESTAMP_EXPIRED',
        'Stripe-Signature timestamp is outside tolerance window',
        event,
        eventId,
        providerTransactionId,
        paymentCode,
      );
    }

    const signedPayload = `${parsedSig.timestampSec}.${params.rawBody}`;
    const valid = parsedSig.signatures.some((sig) =>
      verifyHmacHex({
        algorithm: 'sha256',
        secret: webhookSecret,
        data: signedPayload,
        expectedHex: sig,
      }),
    );

    if (!valid) {
      return this.invalidCallback(
        'INVALID_STRIPE_SIGNATURE',
        'Stripe-Signature HMAC-SHA256 verification failed',
        event,
        eventId,
        providerTransactionId,
        paymentCode,
      );
    }

    const eventType = typeof event['type'] === 'string' ? event['type'] : '';
    const reportedStatus = this.mapStripeEventToStatus(eventType, dataObj);

    const rawAmount = dataObj['amount_total'] ?? dataObj['amount_received'] ?? dataObj['amount'];
    const reportedAmount =
      typeof rawAmount === 'number' && Number.isSafeInteger(rawAmount) && rawAmount > 0
        ? rawAmount
        : null;
    const reportedCurrency =
      typeof dataObj['currency'] === 'string' && dataObj['currency'].trim()
        ? dataObj['currency'].trim().toUpperCase()
        : null;

    const lastError =
      dataObj['last_payment_error'] &&
      typeof dataObj['last_payment_error'] === 'object' &&
      !Array.isArray(dataObj['last_payment_error'])
        ? (dataObj['last_payment_error'] as Record<string, unknown>)
        : null;

    return {
      signatureValid: true,
      rejectionCode: null,
      rejectionReason: null,
      providerEventId: eventId,
      providerTransactionId,
      paymentCode,
      merchantOrderRef:
        typeof metadata['merchantOrderRef'] === 'string'
          ? metadata['merchantOrderRef'].trim()
          : null,
      reportedStatus,
      reportedAmount,
      reportedCurrency,
      paidAt: reportedStatus === PAYMENT_TRANSACTION_STATUS.SUCCEEDED ? new Date() : null,
      failureCode: typeof lastError?.['code'] === 'string' ? lastError['code'] : null,
      failureMessage: typeof lastError?.['message'] === 'string' ? lastError['message'] : null,
      normalizedPayload: event,
      ackBody: { received: true },
    };
  }

  public async refund(params: AdapterRefundParams): Promise<AdapterRefundResult> {
    const secretKey = this.requireString(params.config.secrets['secretKey'], 'secretKey');
    const apiBase = this.resolveApiBase(params.config.config['apiBaseUrl']);
    let paymentIntentId = params.providerTransactionId?.trim() || '';

    if (paymentIntentId.startsWith('cs_')) {
      const session = await this.httpClient
        .forService('payment-stripe')
        .get<Record<string, unknown>>(`${apiBase}/v1/checkout/sessions/${paymentIntentId}`, {
          headers: { authorization: `Bearer ${secretKey}` },
        });
      if (typeof session['payment_intent'] === 'string' && session['payment_intent'].trim()) {
        paymentIntentId = session['payment_intent'].trim();
      }
    }

    const form = new URLSearchParams();
    if (paymentIntentId.startsWith('ch_')) {
      form.set('charge', paymentIntentId);
    } else if (paymentIntentId) {
      form.set('payment_intent', paymentIntentId);
    }
    if (params.refundType === PAYMENT_REFUND_TYPE.PARTIAL) {
      form.set('amount', String(params.refundAmount));
    }
    form.set('metadata[refundCode]', params.refundCode);
    form.set('metadata[paymentCode]', params.paymentCode);
    if (params.reason) {
      form.set('metadata[reason]', params.reason.slice(0, 200));
    }

    const res = await this.httpClient
      .forService('payment-stripe')
      .post<Record<string, unknown>>(`${apiBase}/v1/refunds`, form, {
        headers: {
          authorization: `Bearer ${secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        idempotencyKey: params.idempotencyKey,
      });

    const stripeStatus = String(res['status'] ?? '');
    let status: (typeof PAYMENT_REFUND_STATUS)[keyof typeof PAYMENT_REFUND_STATUS] =
      PAYMENT_REFUND_STATUS.PROCESSING;
    if (stripeStatus === 'succeeded') status = PAYMENT_REFUND_STATUS.SUCCEEDED;
    else if (stripeStatus === 'failed') status = PAYMENT_REFUND_STATUS.FAILED;
    else if (stripeStatus === 'canceled') status = PAYMENT_REFUND_STATUS.CANCELLED;

    return {
      status,
      providerRefundId: typeof res['id'] === 'string' ? res['id'] : null,
      refundedAt: status === PAYMENT_REFUND_STATUS.SUCCEEDED ? new Date() : null,
      failureCode: typeof res['failure_reason'] === 'string' ? res['failure_reason'] : null,
      failureMessage:
        status === PAYMENT_REFUND_STATUS.FAILED ? `Stripe refund status: ${stripeStatus}` : null,
      rawResponse: res,
    };
  }

  public async queryTransaction(
    params: AdapterQueryTransactionParams,
  ): Promise<ProviderTransactionSnapshot | null> {
    const providerTxId = params.providerTransactionId?.trim();
    if (!providerTxId) return null;

    const secretKey = this.requireString(params.config.secrets['secretKey'], 'secretKey');
    const apiBase = this.resolveApiBase(params.config.config['apiBaseUrl']);
    const endpoint = providerTxId.startsWith('cs_')
      ? `${apiBase}/v1/checkout/sessions/${encodeURIComponent(providerTxId)}`
      : `${apiBase}/v1/payment_intents/${encodeURIComponent(providerTxId)}`;

    const res = await this.httpClient
      .forService('payment-stripe')
      .get<Record<string, unknown>>(endpoint, {
        headers: { authorization: `Bearer ${secretKey}` },
      });

    let status: PaymentTransactionStatusCode = PAYMENT_TRANSACTION_STATUS.PENDING;
    if (providerTxId.startsWith('cs_')) {
      const payStatus = String(res['payment_status'] ?? '');
      const sessStatus = String(res['status'] ?? '');
      if (payStatus === 'paid') status = PAYMENT_TRANSACTION_STATUS.SUCCEEDED;
      else if (sessStatus === 'expired') status = PAYMENT_TRANSACTION_STATUS.EXPIRED;
      else if (sessStatus === 'open') status = PAYMENT_TRANSACTION_STATUS.PENDING;
      else status = PAYMENT_TRANSACTION_STATUS.PROCESSING;
    } else {
      const piStatus = String(res['status'] ?? '');
      if (piStatus === 'succeeded') status = PAYMENT_TRANSACTION_STATUS.SUCCEEDED;
      else if (piStatus === 'processing') status = PAYMENT_TRANSACTION_STATUS.PROCESSING;
      else if (piStatus === 'canceled') status = PAYMENT_TRANSACTION_STATUS.CANCELLED;
      else if (piStatus === 'requires_payment_method') status = PAYMENT_TRANSACTION_STATUS.FAILED;
    }

    const rawAmount = res['amount_total'] ?? res['amount_received'] ?? res['amount'];
    const amount =
      typeof rawAmount === 'number' && Number.isSafeInteger(rawAmount) ? rawAmount : params.amount;
    const currency =
      typeof res['currency'] === 'string' && res['currency'].trim()
        ? res['currency'].trim().toUpperCase()
        : params.currency;

    return {
      providerCode: params.config.providerCode,
      paymentCode: params.paymentCode,
      merchantOrderRef: params.merchantOrderRef,
      providerTransactionId: providerTxId,
      status,
      amount,
      refundedAmount: 0,
      currency,
      paidAt: status === PAYMENT_TRANSACTION_STATUS.SUCCEEDED ? params.createdAt : null,
      rawSnapshot: res,
    };
  }

  private extractEventObject(event: Record<string, unknown>): Record<string, unknown> {
    const data = event['data'];
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const obj = (data as Record<string, unknown>)['object'];
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        return obj as Record<string, unknown>;
      }
    }
    return {};
  }

  private mapStripeEventToStatus(
    eventType: string,
    dataObj: Record<string, unknown>,
  ): PaymentTransactionStatusCode {
    if (eventType === 'checkout.session.completed') {
      return dataObj['payment_status'] === 'paid'
        ? PAYMENT_TRANSACTION_STATUS.SUCCEEDED
        : PAYMENT_TRANSACTION_STATUS.PROCESSING;
    }
    if (
      eventType === 'checkout.session.async_payment_succeeded' ||
      eventType === 'payment_intent.succeeded' ||
      eventType === 'charge.succeeded'
    ) {
      return PAYMENT_TRANSACTION_STATUS.SUCCEEDED;
    }
    if (
      eventType === 'checkout.session.async_payment_failed' ||
      eventType === 'payment_intent.payment_failed' ||
      eventType === 'charge.failed'
    ) {
      return PAYMENT_TRANSACTION_STATUS.FAILED;
    }
    if (eventType === 'checkout.session.expired') {
      return PAYMENT_TRANSACTION_STATUS.EXPIRED;
    }
    if (eventType === 'payment_intent.canceled') {
      return PAYMENT_TRANSACTION_STATUS.CANCELLED;
    }
    return PAYMENT_TRANSACTION_STATUS.PROCESSING;
  }

  private invalidCallback(
    rejectionCode: string,
    rejectionReason: string,
    event: Record<string, unknown>,
    providerEventId: string | null,
    providerTransactionId: string | null,
    paymentCode: string | null,
  ): VerifiedPaymentCallback {
    return {
      signatureValid: false,
      rejectionCode,
      rejectionReason,
      providerEventId,
      providerTransactionId,
      paymentCode,
      merchantOrderRef: null,
      reportedStatus: null,
      reportedAmount: null,
      reportedCurrency: null,
      paidAt: null,
      failureCode: rejectionCode,
      failureMessage: rejectionReason,
      normalizedPayload: event,
      ackBody: { received: false, error: rejectionCode },
    };
  }

  private resolveApiBase(raw: unknown): string {
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim().replace(/\/+$/, '');
    }
    return STRIPE_DEFAULT_API_BASE;
  }

  private requireString(val: unknown, field: string): string {
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
    throw new BadRequestAppException('payments.providerConfigMissing', [
      {
        driver: this.driverCode,
        field,
      },
    ]);
  }
}

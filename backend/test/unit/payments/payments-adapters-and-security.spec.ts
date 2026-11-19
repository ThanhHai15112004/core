import { createHmac } from 'node:crypto';
import { describe, expect, it, jest } from '@jest/globals';
import type { HttpClientContract, ScopedHttpClientContract } from '@packages/http-client/index.js';
import { BadRequestAppException } from '@packages/kernel/index.js';
import { MoMoPaymentAdapter } from '../../../src/modules/payments/adapters/momo-payment.adapter.js';
import { SandboxPaymentAdapter } from '../../../src/modules/payments/adapters/sandbox-payment.adapter.js';
import { StripePaymentAdapter } from '../../../src/modules/payments/adapters/stripe-payment.adapter.js';
import { VnPayPaymentAdapter } from '../../../src/modules/payments/adapters/vnpay-payment.adapter.js';
import {
  PAYMENT_DRIVER_CODE,
  PAYMENT_ENVIRONMENT,
  PAYMENT_REFUND_STATUS,
  PAYMENT_REFUND_TYPE,
  PAYMENT_TRANSACTION_STATUS,
} from '../../../src/modules/payments/enum/payments.enum.js';
import {
  redactPaymentHeaders,
  redactPaymentObject,
  serializeRedactedPaymentPayload,
} from '../../../src/modules/payments/helpers/payment-redaction.helper.js';
import {
  buildVnPayCanonicalQuery,
  hmacHex,
} from '../../../src/modules/payments/helpers/payment-signature.helper.js';
import { canTransitionPaymentStatus } from '../../../src/modules/payments/helpers/payment-state-machine.helper.js';
import type { PaymentAdapterResolvedConfig } from '../../../src/modules/payments/types/payments.types.js';

function createMockHttpClient(
  postImpl?: ScopedHttpClientContract['post'],
  getImpl?: ScopedHttpClientContract['get'],
): HttpClientContract {
  const scoped: ScopedHttpClientContract = {
    get: getImpl ?? (jest.fn() as unknown as ScopedHttpClientContract['get']),
    post: postImpl ?? (jest.fn() as unknown as ScopedHttpClientContract['post']),
    put: jest.fn() as unknown as ScopedHttpClientContract['put'],
    patch: jest.fn() as unknown as ScopedHttpClientContract['patch'],
    delete: jest.fn() as unknown as ScopedHttpClientContract['delete'],
    requestRaw: jest.fn() as unknown as ScopedHttpClientContract['requestRaw'],
  };
  return {
    ...scoped,
    forService: () => scoped,
  };
}

function buildConfig(
  driverCode: PaymentAdapterResolvedConfig['driverCode'],
  config: Record<string, unknown>,
  secrets: Record<string, string>,
): PaymentAdapterResolvedConfig {
  return {
    providerId: 1,
    providerCode: driverCode,
    driverCode,
    environment: PAYMENT_ENVIRONMENT.SANDBOX,
    supportsPartialRefund: true,
    allowedCurrencies: ['VND', 'USD'],
    config,
    secrets,
    callbackToleranceSec: 300,
  };
}

describe('Payment Adapters, Signatures, State Machine & Redaction (Unit)', () => {
  it('SandboxPaymentAdapter signs & verifies callback, rejects tampered & expired signatures', async () => {
    const adapter = new SandboxPaymentAdapter();
    const cfg = buildConfig(PAYMENT_DRIVER_CODE.SANDBOX, {}, { webhookSecret: 'whsec_test_123' });

    const created = await adapter.createPayment({
      config: cfg,
      paymentCode: 'PAY-202611-000001',
      idempotencyKey: 'idem-sbx-1',
      merchantOrderRef: 'ORD-100',
      amount: 150_000,
      currency: 'VND',
      description: 'Test Sandbox',
      returnUrl: 'https://app.local/return',
      cancelUrl: null,
      locale: 'vi',
      expiresAt: new Date(Date.now() + 900_000),
      customer: null,
      metadata: {},
    });
    expect(created.providerTransactionId).toMatch(/^sbx_tx_/);
    expect(created.checkoutUrl).toContain('PAY-202611-000001');

    const rawBody = JSON.stringify({
      eventId: 'evt_1',
      paymentCode: 'PAY-202611-000001',
      providerTransactionId: created.providerTransactionId,
      status: PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
      amount: 150_000,
      currency: 'VND',
    });
    const nowSec = 1_795_000_000;
    const signed = SandboxPaymentAdapter.signCallbackPayload({
      rawBody,
      webhookSecret: 'whsec_test_123',
      timestampSec: nowSec,
    });

    const verified = await adapter.verifyCallback({
      config: cfg,
      httpMethod: 'POST',
      rawBody,
      parsedBody: JSON.parse(rawBody),
      query: {},
      headers: { 'x-sandbox-signature': signed.header },
      nowSec: nowSec + 10,
    });
    expect(verified.signatureValid).toBe(true);
    expect(verified.reportedStatus).toBe(PAYMENT_TRANSACTION_STATUS.SUCCEEDED);
    expect(verified.reportedAmount).toBe(150_000);

    const expired = await adapter.verifyCallback({
      config: cfg,
      httpMethod: 'POST',
      rawBody,
      parsedBody: JSON.parse(rawBody),
      query: {},
      headers: { 'x-sandbox-signature': signed.header },
      nowSec: nowSec + 999,
    });
    expect(expired.signatureValid).toBe(false);
    expect(expired.rejectionCode).toBe('TIMESTAMP_EXPIRED');

    const tampered = await adapter.verifyCallback({
      config: cfg,
      httpMethod: 'POST',
      rawBody: rawBody.replace('150000', '1000'),
      parsedBody: {},
      query: {},
      headers: { 'x-sandbox-signature': signed.header },
      nowSec: nowSec + 5,
    });
    expect(tampered.signatureValid).toBe(false);
    expect(tampered.rejectionCode).toBe('SIGNATURE_MISMATCH');
  });

  it('VnPayPaymentAdapter signs checkout URL (amount*100), verifies HMAC-SHA512 IPN, refunds (02/03) and queries', async () => {
    const postMock = jest.fn(async (url: string, body: unknown) => {
      const payload = body as Record<string, unknown>;
      expect(url).toContain('merchant_webapi');
      if (payload['vnp_Command'] === 'refund') {
        return { vnp_ResponseCode: '00', vnp_TransactionNo: 'VNP_REF_999' };
      }
      return {
        vnp_ResponseCode: '00',
        vnp_TransactionStatus: '00',
        vnp_Amount: '25000000',
        vnp_TransactionNo: '1445566',
      };
    });
    const adapter = new VnPayPaymentAdapter(
      createMockHttpClient(postMock as unknown as ScopedHttpClientContract['post']),
    );
    const cfg = buildConfig(
      PAYMENT_DRIVER_CODE.VNPAY,
      { tmnCode: 'TMN001' },
      { hashSecret: 'VNPAY_SECRET_ABC' },
    );

    await expect(
      adapter.createPayment({
        config: cfg,
        paymentCode: 'PAY-202611-000002',
        idempotencyKey: 'idem-vnp-usd',
        merchantOrderRef: 'ORD-VNP-USD',
        amount: 1000,
        currency: 'USD',
        description: 'Invalid currency',
        returnUrl: 'https://app.local/vnpay/return',
        cancelUrl: null,
        locale: 'vi',
        expiresAt: new Date(Date.now() + 600_000),
        customer: null,
        metadata: {},
      }),
    ).rejects.toBeInstanceOf(BadRequestAppException);

    const created = await adapter.createPayment({
      config: cfg,
      paymentCode: 'PAY-202611-000002',
      idempotencyKey: 'idem-vnp-1',
      merchantOrderRef: 'ORD-VNP-1',
      amount: 250_000,
      currency: 'VND',
      description: 'Thanh toan don hang',
      returnUrl: 'https://app.local/vnpay/return',
      cancelUrl: null,
      locale: 'vi',
      expiresAt: new Date(Date.now() + 600_000),
      customer: null,
      metadata: {},
    });
    const url = new URL(created.checkoutUrl!);
    expect(url.searchParams.get('vnp_Amount')).toBe('25000000');
    expect(url.searchParams.get('vnp_SecureHash')).toBeTruthy();

    const ipnParams: Record<string, string> = {
      vnp_TmnCode: 'TMN001',
      vnp_Amount: '25000000',
      vnp_TxnRef: 'PAY-202611-000002',
      vnp_TransactionNo: '1445566',
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_CurrCode: 'VND',
    };
    const secureHash = hmacHex('sha512', 'VNPAY_SECRET_ABC', buildVnPayCanonicalQuery(ipnParams));
    const verified = await adapter.verifyCallback({
      config: cfg,
      httpMethod: 'GET',
      rawBody: '',
      parsedBody: {},
      query: { ...ipnParams, vnp_SecureHash: secureHash },
      headers: {},
    });
    expect(verified.signatureValid).toBe(true);
    expect(verified.reportedAmount).toBe(250_000);
    expect(verified.reportedStatus).toBe(PAYMENT_TRANSACTION_STATUS.SUCCEEDED);
    expect(verified.providerTransactionId).toBe('1445566');

    const tampered = await adapter.verifyCallback({
      config: cfg,
      httpMethod: 'GET',
      rawBody: '',
      parsedBody: {},
      query: { ...ipnParams, vnp_Amount: '100', vnp_SecureHash: secureHash },
      headers: {},
    });
    expect(tampered.signatureValid).toBe(false);

    const partialRefund = await adapter.refund({
      config: cfg,
      paymentCode: 'PAY-202611-000002',
      refundCode: 'RFD-202611-000001',
      idempotencyKey: 'idem-ref-vnp-1',
      refundType: PAYMENT_REFUND_TYPE.PARTIAL,
      refundAmount: 50_000,
      originalAmount: 250_000,
      currency: 'VND',
      providerTransactionId: '1445566',
      merchantOrderRef: 'ORD-VNP-1',
      paidAt: new Date(),
      reason: 'Partial refund',
      actorIdentifier: 'admin@core.local',
    });
    expect(partialRefund.status).toBe(PAYMENT_REFUND_STATUS.SUCCEEDED);
    expect(partialRefund.providerRefundId).toBe('VNP_REF_999');

    const snapshot = await adapter.queryTransaction({
      config: cfg,
      paymentCode: 'PAY-202611-000002',
      merchantOrderRef: 'ORD-VNP-1',
      providerTransactionId: '1445566',
      amount: 250_000,
      currency: 'VND',
      createdAt: new Date(),
    });
    expect(snapshot?.status).toBe(PAYMENT_TRANSACTION_STATUS.SUCCEEDED);
    expect(snapshot?.amount).toBe(250_000);
  });

  it('MoMoPaymentAdapter creates payment, verifies IPN HMAC-SHA256, refunds and queries', async () => {
    const postMock = jest.fn(async (url: string) => {
      if (url.endsWith('/create')) {
        return {
          resultCode: 0,
          payUrl: 'https://test-payment.momo.vn/pay/123',
          qrCodeUrl: 'momo://qr/123',
          transId: 99887766,
        };
      }
      if (url.endsWith('/refund')) {
        return { resultCode: 0, transId: 55443322 };
      }
      return {
        resultCode: 0,
        amount: 120_000,
        transId: 99887766,
        refundTrans: [{ resultCode: 0, amount: 20_000 }],
      };
    });

    const adapter = new MoMoPaymentAdapter(
      createMockHttpClient(postMock as unknown as ScopedHttpClientContract['post']),
    );
    const cfg = buildConfig(
      PAYMENT_DRIVER_CODE.MOMO,
      { partnerCode: 'MOMO_PARTNER', ipnUrl: 'https://api.local/payments/callbacks/momo' },
      { accessKey: 'momo_access', secretKey: 'momo_secret_key' },
    );

    const created = await adapter.createPayment({
      config: cfg,
      paymentCode: 'PAY-202611-000003',
      idempotencyKey: 'idem-momo-1',
      merchantOrderRef: 'ORD-MOMO-1',
      amount: 120_000,
      currency: 'VND',
      description: 'MoMo test',
      returnUrl: 'https://app.local/return',
      cancelUrl: null,
      locale: 'vi',
      expiresAt: new Date(Date.now() + 600_000),
      customer: null,
      metadata: {},
    });
    expect(created.checkoutUrl).toBe('https://test-payment.momo.vn/pay/123');
    expect(created.qrPayload).toBe('momo://qr/123');

    const ipnBody = {
      partnerCode: 'MOMO_PARTNER',
      orderId: 'PAY-202611-000003',
      requestId: 'idem-momo-1',
      amount: 120_000,
      orderInfo: 'MoMo test',
      orderType: 'momo_wallet',
      transId: 99887766,
      resultCode: 0,
      message: 'Successful.',
      payType: 'qr',
      responseTime: 1795000000000,
      extraData: '',
    };
    const rawSigStr =
      `accessKey=momo_access&amount=120000&extraData=&message=Successful.` +
      `&orderId=PAY-202611-000003&orderInfo=MoMo test&orderType=momo_wallet` +
      `&partnerCode=MOMO_PARTNER&payType=qr&requestId=idem-momo-1` +
      `&responseTime=1795000000000&resultCode=0&transId=99887766`;
    const sig = createHmac('sha256', 'momo_secret_key').update(rawSigStr).digest('hex');

    const verified = await adapter.verifyCallback({
      config: cfg,
      httpMethod: 'POST',
      rawBody: JSON.stringify({ ...ipnBody, signature: sig }),
      parsedBody: { ...ipnBody, signature: sig },
      query: {},
      headers: {},
    });
    expect(verified.signatureValid).toBe(true);
    expect(verified.reportedStatus).toBe(PAYMENT_TRANSACTION_STATUS.SUCCEEDED);
    expect(verified.reportedAmount).toBe(120_000);

    const snapshot = await adapter.queryTransaction({
      config: cfg,
      paymentCode: 'PAY-202611-000003',
      merchantOrderRef: 'ORD-MOMO-1',
      providerTransactionId: '99887766',
      amount: 120_000,
      currency: 'VND',
      createdAt: new Date(),
    });
    expect(snapshot?.status).toBe(PAYMENT_TRANSACTION_STATUS.PARTIALLY_REFUNDED);
    expect(snapshot?.refundedAmount).toBe(20_000);
  });

  it('StripePaymentAdapter creates checkout session, verifies rotated Stripe-Signature and refunds', async () => {
    const postMock = jest.fn(async (url: string) => {
      if (url.endsWith('/v1/checkout/sessions')) {
        return { id: 'cs_test_123', url: 'https://checkout.stripe.com/c/pay/cs_test_123' };
      }
      return { id: 're_test_456', status: 'succeeded' };
    });
    const getMock = jest.fn(async (url: string) => {
      if (url.includes('/v1/checkout/sessions/')) {
        return {
          id: 'cs_test_123',
          payment_intent: 'pi_test_789',
          payment_status: 'paid',
          status: 'complete',
          amount_total: 1050,
          currency: 'usd',
        };
      }
      return {};
    });

    const adapter = new StripePaymentAdapter(
      createMockHttpClient(
        postMock as unknown as ScopedHttpClientContract['post'],
        getMock as unknown as ScopedHttpClientContract['get'],
      ),
    );
    const cfg = buildConfig(
      PAYMENT_DRIVER_CODE.STRIPE,
      {},
      { secretKey: 'sk_test_123', webhookSecret: 'whsec_stripe_456' },
    );

    const created = await adapter.createPayment({
      config: cfg,
      paymentCode: 'PAY-202611-000004',
      idempotencyKey: 'idem-stripe-1',
      merchantOrderRef: 'ORD-USD-1',
      amount: 1050,
      currency: 'USD',
      description: 'Stripe Plan',
      returnUrl: 'https://app.local/success',
      cancelUrl: 'https://app.local/cancel',
      locale: 'en',
      expiresAt: new Date(Date.now() + 900_000),
      customer: { email: 'buyer@example.com' },
      metadata: {},
    });
    expect(created.providerTransactionId).toBe('cs_test_123');
    expect(created.checkoutUrl).toContain('checkout.stripe.com');

    const evtPayload = JSON.stringify({
      id: 'evt_stripe_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          payment_intent: 'pi_test_789',
          payment_status: 'paid',
          amount_total: 1050,
          currency: 'usd',
          client_reference_id: 'PAY-202611-000004',
          metadata: { paymentCode: 'PAY-202611-000004', merchantOrderRef: 'ORD-USD-1' },
        },
      },
    });
    const ts = 1_795_000_000;
    const v1 = hmacHex('sha256', 'whsec_stripe_456', `${ts}.${evtPayload}`);
    const verified = await adapter.verifyCallback({
      config: cfg,
      httpMethod: 'POST',
      rawBody: evtPayload,
      parsedBody: JSON.parse(evtPayload),
      query: {},
      headers: { 'stripe-signature': `t=${ts},v1=old_sig,v1=${v1}` },
      nowSec: ts + 30,
    });
    expect(verified.signatureValid).toBe(true);
    expect(verified.reportedAmount).toBe(1050);
    expect(verified.reportedCurrency).toBe('USD');
    expect(verified.providerTransactionId).toBe('pi_test_789');

    const refund = await adapter.refund({
      config: cfg,
      paymentCode: 'PAY-202611-000004',
      refundCode: 'RFD-202611-000002',
      idempotencyKey: 'idem-stripe-ref',
      refundType: PAYMENT_REFUND_TYPE.PARTIAL,
      refundAmount: 500,
      originalAmount: 1050,
      currency: 'USD',
      providerTransactionId: 'cs_test_123',
      merchantOrderRef: 'ORD-USD-1',
      paidAt: new Date(),
      reason: 'Customer requested partial refund',
      actorIdentifier: 'admin@core.local',
    });
    expect(refund.status).toBe(PAYMENT_REFUND_STATUS.SUCCEEDED);
    expect(refund.providerRefundId).toBe('re_test_456');
  });

  it('State machine & redaction helpers enforce terminal invariants and strip secrets', () => {
    expect(
      canTransitionPaymentStatus(
        PAYMENT_TRANSACTION_STATUS.PENDING,
        PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
      ),
    ).toBe(true);
    expect(
      canTransitionPaymentStatus(
        PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
        PAYMENT_TRANSACTION_STATUS.FAILED,
      ),
    ).toBe(false);
    expect(
      canTransitionPaymentStatus(
        PAYMENT_TRANSACTION_STATUS.REFUNDED,
        PAYMENT_TRANSACTION_STATUS.SUCCEEDED,
      ),
    ).toBe(false);

    const redacted = redactPaymentObject({
      paymentCode: 'PAY-1',
      cardNumber: '4242424242424242',
      hashSecret: 'super-secret',
      nested: { webhookSecret: 'whsec_abc', amount: 5000 },
    });
    expect(redacted['cardNumber']).not.toBe('4242424242424242');
    expect(redacted['hashSecret']).not.toBe('super-secret');
    expect((redacted['nested'] as Record<string, unknown>)['webhookSecret']).not.toBe('whsec_abc');

    const redactedHeaders = redactPaymentHeaders({
      authorization: 'Bearer sk_live_123',
      'x-sandbox-signature': 't=1,v1=abc',
    });
    expect(redactedHeaders['authorization']).not.toContain('sk_live_123');

    const serialized = serializeRedactedPaymentPayload(
      { big: 'x'.repeat(2000), secretKey: 'sk_123' },
      400,
    );
    expect(serialized).toContain('"_truncated":true');
    expect(serialized).not.toContain('sk_123');
  });
});

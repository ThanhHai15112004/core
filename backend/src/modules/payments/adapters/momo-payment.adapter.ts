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
  PAYMENT_TRANSACTION_STATUS,
  type PaymentTransactionStatusCode,
} from '../enum/payments.enum.js';
import { hmacHex, verifyHmacHex } from '../helpers/payment-signature.helper.js';
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

const MOMO_DEFAULT_BASE_URL = 'https://test-payment.momo.vn';

@Injectable()
export class MoMoPaymentAdapter implements IPaymentProviderAdapter {
  public readonly driverCode = PAYMENT_DRIVER_CODE.MOMO;
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
      displayName: 'MoMo e-Wallet',
      description:
        'Cổng thanh toán MoMo v2: ký HMAC-SHA256 tạo phiên, xác minh IPN callback, hoàn tiền toàn phần/một phần và truy vấn trạng thái giao dịch.',
      supportsPartialRefund: true,
      supportedCurrencies: ['VND'],
      requiredConfigFields: ['partnerCode', 'ipnUrl'],
      requiredSecretFields: ['accessKey', 'secretKey'],
    };
  }

  public async createPayment(
    params: AdapterCreatePaymentParams,
  ): Promise<AdapterCreatePaymentResult> {
    if (params.currency !== 'VND') {
      throw new BadRequestAppException('payments.currencyNotSupported', [
        {
          currency: params.currency,
          driver: this.driverCode,
        },
      ]);
    }

    const partnerCode = this.requireString(params.config.config['partnerCode'], 'partnerCode');
    const accessKey = this.requireString(params.config.secrets['accessKey'], 'accessKey');
    const secretKey = this.requireString(params.config.secrets['secretKey'], 'secretKey');
    const baseUrl = this.resolveBaseUrl(params.config.config['endpointBaseUrl']);
    const ipnUrl =
      (typeof params.config.config['ipnUrl'] === 'string' &&
        params.config.config['ipnUrl'].trim()) ||
      params.returnUrl ||
      'https://localhost/api/v1/payments/callbacks/momo';
    const redirectUrl = params.returnUrl || 'https://localhost/payments/momo/return';
    const requestType =
      (typeof params.config.config['requestType'] === 'string' &&
        params.config.config['requestType'].trim()) ||
      'captureWallet';
    const extraData =
      typeof params.config.config['extraData'] === 'string'
        ? params.config.config['extraData']
        : '';

    const requestId = params.idempotencyKey.slice(0, 50);
    const orderId = params.paymentCode;
    const orderInfo = params.description.slice(0, 255);
    const amount = String(params.amount);

    const rawSignature =
      `accessKey=${accessKey}&amount=${amount}&extraData=${extraData}` +
      `&ipnUrl=${ipnUrl}&orderId=${orderId}&orderInfo=${orderInfo}` +
      `&partnerCode=${partnerCode}&redirectUrl=${redirectUrl}` +
      `&requestId=${requestId}&requestType=${requestType}`;

    const signature = hmacHex('sha256', secretKey, rawSignature);
    const res = await this.httpClient
      .forService('payment-momo')
      .post<Record<string, unknown>>(`${baseUrl}/v2/gateway/api/create`, {
        partnerCode,
        requestId,
        amount: params.amount,
        orderId,
        orderInfo,
        redirectUrl,
        ipnUrl,
        requestType,
        extraData,
        lang: params.locale.toLowerCase().startsWith('en') ? 'en' : 'vi',
        signature,
      });

    const resultCode = Number(res['resultCode'] ?? -1);
    if (resultCode !== 0) {
      return {
        providerTransactionId:
          res['transId'] !== undefined && res['transId'] !== null ? String(res['transId']) : null,
        status: PAYMENT_TRANSACTION_STATUS.FAILED,
        checkoutUrl: null,
        qrPayload: null,
        rawResponse: res,
      };
    }

    return {
      providerTransactionId:
        res['transId'] !== undefined && res['transId'] !== null
          ? String(res['transId'])
          : requestId,
      status: PAYMENT_TRANSACTION_STATUS.PENDING,
      checkoutUrl: typeof res['payUrl'] === 'string' ? res['payUrl'] : null,
      qrPayload: typeof res['qrCodeUrl'] === 'string' ? res['qrCodeUrl'] : null,
      rawResponse: res,
    };
  }

  public async verifyCallback(
    params: AdapterVerifyCallbackParams,
  ): Promise<VerifiedPaymentCallback> {
    const accessKey = params.config.secrets['accessKey'] ?? '';
    const secretKey = params.config.secrets['secretKey'] ?? '';
    const body =
      params.parsedBody &&
      typeof params.parsedBody === 'object' &&
      !Array.isArray(params.parsedBody)
        ? (params.parsedBody as Record<string, unknown>)
        : safeJsonParseObject<Record<string, unknown>>(params.rawBody, {});

    const str = (key: string) =>
      body[key] === undefined || body[key] === null ? '' : String(body[key]);

    const rawSignature =
      `accessKey=${accessKey}` +
      `&amount=${str('amount')}` +
      `&extraData=${str('extraData')}` +
      `&message=${str('message')}` +
      `&orderId=${str('orderId')}` +
      `&orderInfo=${str('orderInfo')}` +
      `&orderType=${str('orderType')}` +
      `&partnerCode=${str('partnerCode')}` +
      `&payType=${str('payType')}` +
      `&requestId=${str('requestId')}` +
      `&responseTime=${str('responseTime')}` +
      `&resultCode=${str('resultCode')}` +
      `&transId=${str('transId')}`;

    const receivedSig = str('signature');
    const valid =
      Boolean(accessKey) &&
      Boolean(secretKey) &&
      Boolean(receivedSig) &&
      verifyHmacHex({
        algorithm: 'sha256',
        secret: secretKey,
        data: rawSignature,
        expectedHex: receivedSig,
      });

    const paymentCode = str('orderId').trim() || null;
    const providerTransactionId = str('transId').trim() || null;
    const providerEventId = str('requestId').trim() || providerTransactionId;

    if (!valid) {
      return {
        signatureValid: false,
        rejectionCode: 'INVALID_MOMO_SIGNATURE',
        rejectionReason: 'MoMo IPN HMAC-SHA256 signature verification failed',
        providerEventId,
        providerTransactionId,
        paymentCode,
        merchantOrderRef: null,
        reportedStatus: null,
        reportedAmount: null,
        reportedCurrency: 'VND',
        paidAt: null,
        failureCode: 'INVALID_SIGNATURE',
        failureMessage: 'MoMo signature mismatch',
        normalizedPayload: body,
        ackBody: { status: 1, message: 'Invalid signature' },
      };
    }

    const resultCode = Number(body['resultCode'] ?? -1);
    const reportedStatus = this.mapMoMoResultCode(resultCode);
    const amountNum = Number(body['amount']);
    const reportedAmount =
      Number.isFinite(amountNum) && Number.isSafeInteger(amountNum) && amountNum > 0
        ? amountNum
        : null;

    return {
      signatureValid: true,
      rejectionCode: null,
      rejectionReason: null,
      providerEventId,
      providerTransactionId,
      paymentCode,
      merchantOrderRef: null,
      reportedStatus,
      reportedAmount,
      reportedCurrency: 'VND',
      paidAt: reportedStatus === PAYMENT_TRANSACTION_STATUS.SUCCEEDED ? new Date() : null,
      failureCode:
        reportedStatus === PAYMENT_TRANSACTION_STATUS.SUCCEEDED ? null : String(resultCode),
      failureMessage:
        reportedStatus === PAYMENT_TRANSACTION_STATUS.SUCCEEDED ? null : str('message') || null,
      normalizedPayload: body,
      ackBody: { status: 0, message: 'OK' },
    };
  }

  public async refund(params: AdapterRefundParams): Promise<AdapterRefundResult> {
    const partnerCode = this.requireString(params.config.config['partnerCode'], 'partnerCode');
    const accessKey = this.requireString(params.config.secrets['accessKey'], 'accessKey');
    const secretKey = this.requireString(params.config.secrets['secretKey'], 'secretKey');
    const baseUrl = this.resolveBaseUrl(params.config.config['endpointBaseUrl']);

    const requestId = params.idempotencyKey.slice(0, 50);
    const orderId = params.refundCode;
    const transIdNum = Number(params.providerTransactionId);
    const transId =
      Number.isSafeInteger(transIdNum) && transIdNum > 0
        ? transIdNum
        : params.providerTransactionId || params.paymentCode;
    const description = (params.reason || `Refund ${params.paymentCode}`).slice(0, 255);

    const rawSignature =
      `accessKey=${accessKey}&amount=${params.refundAmount}` +
      `&description=${description}&orderId=${orderId}` +
      `&partnerCode=${partnerCode}&requestId=${requestId}&transId=${String(transId)}`;

    const signature = hmacHex('sha256', secretKey, rawSignature);
    const res = await this.httpClient
      .forService('payment-momo')
      .post<Record<string, unknown>>(`${baseUrl}/v2/gateway/api/refund`, {
        partnerCode,
        orderId,
        requestId,
        amount: params.refundAmount,
        transId,
        lang: 'vi',
        description,
        signature,
      });

    const resultCode = Number(res['resultCode'] ?? -1);
    const success = resultCode === 0;
    return {
      status: success ? PAYMENT_REFUND_STATUS.SUCCEEDED : PAYMENT_REFUND_STATUS.FAILED,
      providerRefundId:
        res['transId'] !== undefined && res['transId'] !== null ? String(res['transId']) : orderId,
      refundedAt: success ? new Date() : null,
      failureCode: success ? null : String(resultCode),
      failureMessage: success
        ? null
        : typeof res['message'] === 'string'
          ? res['message']
          : `MoMo refund failed (${resultCode})`,
      rawResponse: res,
    };
  }

  public async queryTransaction(
    params: AdapterQueryTransactionParams,
  ): Promise<ProviderTransactionSnapshot | null> {
    const partnerCode = this.requireString(params.config.config['partnerCode'], 'partnerCode');
    const accessKey = this.requireString(params.config.secrets['accessKey'], 'accessKey');
    const secretKey = this.requireString(params.config.secrets['secretKey'], 'secretKey');
    const baseUrl = this.resolveBaseUrl(params.config.config['endpointBaseUrl']);

    const requestId = `Q-${params.paymentCode}-${Date.now()}`.slice(0, 50);
    const rawSignature =
      `accessKey=${accessKey}&orderId=${params.paymentCode}` +
      `&partnerCode=${partnerCode}&requestId=${requestId}`;
    const signature = hmacHex('sha256', secretKey, rawSignature);

    const res = await this.httpClient
      .forService('payment-momo')
      .post<Record<string, unknown>>(`${baseUrl}/v2/gateway/api/query`, {
        partnerCode,
        requestId,
        orderId: params.paymentCode,
        lang: 'vi',
        signature,
      });

    const resultCode = Number(res['resultCode'] ?? -1);
    if (resultCode === 1001 || resultCode === 1017) {
      return null;
    }

    const amount = Number(res['amount'] ?? params.amount);
    const refundTrans = Array.isArray(res['refundTrans'])
      ? (res['refundTrans'] as Array<Record<string, unknown>>)
      : [];
    const refundedAmount = refundTrans.reduce((sum, item) => {
      const rCode = Number(item?.['resultCode'] ?? 0);
      const rAmt = Number(item?.['amount'] ?? 0);
      return rCode === 0 && Number.isFinite(rAmt) ? sum + rAmt : sum;
    }, 0);

    let status = this.mapMoMoResultCode(resultCode);
    if (status === PAYMENT_TRANSACTION_STATUS.SUCCEEDED && refundedAmount > 0) {
      status =
        refundedAmount >= amount
          ? PAYMENT_TRANSACTION_STATUS.REFUNDED
          : PAYMENT_TRANSACTION_STATUS.PARTIALLY_REFUNDED;
    }

    return {
      providerCode: params.config.providerCode,
      paymentCode: params.paymentCode,
      merchantOrderRef: params.merchantOrderRef,
      providerTransactionId:
        res['transId'] !== undefined && res['transId'] !== null
          ? String(res['transId'])
          : params.providerTransactionId,
      status,
      amount: Number.isFinite(amount) ? amount : params.amount,
      refundedAmount,
      currency: 'VND',
      paidAt:
        status === PAYMENT_TRANSACTION_STATUS.SUCCEEDED ||
        status === PAYMENT_TRANSACTION_STATUS.PARTIALLY_REFUNDED ||
        status === PAYMENT_TRANSACTION_STATUS.REFUNDED
          ? params.createdAt
          : null,
      rawSnapshot: res,
    };
  }

  private mapMoMoResultCode(resultCode: number): PaymentTransactionStatusCode {
    if (resultCode === 0) return PAYMENT_TRANSACTION_STATUS.SUCCEEDED;
    if (resultCode === 1000 || resultCode === 7000 || resultCode === 7002) {
      return PAYMENT_TRANSACTION_STATUS.PROCESSING;
    }
    if (resultCode === 1006) return PAYMENT_TRANSACTION_STATUS.CANCELLED;
    if (resultCode === 1005) return PAYMENT_TRANSACTION_STATUS.EXPIRED;
    return PAYMENT_TRANSACTION_STATUS.FAILED;
  }

  private resolveBaseUrl(raw: unknown): string {
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim().replace(/\/+$/, '');
    }
    return MOMO_DEFAULT_BASE_URL;
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

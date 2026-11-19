import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BaseHttpClientProvider,
  HTTP_CLIENT_TOKEN,
  type HttpClientContract,
} from '@packages/http-client/index.js';
import { BadRequestAppException } from '@packages/kernel/index.js';
import type { IPaymentProviderAdapter } from '../contracts/index.js';
import {
  PAYMENT_DRIVER_CODE,
  PAYMENT_REFUND_STATUS,
  PAYMENT_REFUND_TYPE,
  PAYMENT_TRANSACTION_STATUS,
  type PaymentTransactionStatusCode,
} from '../enum/payments.enum.js';
import {
  buildVnPayCanonicalQuery,
  formatVnPayDateGmt7,
  hmacHex,
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

const VNPAY_DEFAULT_PAYMENT_URL = 'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
const VNPAY_DEFAULT_API_URL = 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction';
const VNPAY_VERSION = '2.1.0';

@Injectable()
export class VnPayPaymentAdapter implements IPaymentProviderAdapter {
  public readonly driverCode = PAYMENT_DRIVER_CODE.VNPAY;
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
      displayName: 'VNPay Gateway',
      description:
        'Cổng thanh toán VNPay v2.1.0: ký tham số HMAC-SHA512, xác minh IPN/ReturnURL, hoàn tiền toàn phần/một phần (`02`/`03`) và truy vấn đối soát `querydr`.',
      supportsPartialRefund: true,
      supportedCurrencies: ['VND'],
      requiredConfigFields: ['tmnCode'],
      requiredSecretFields: ['hashSecret'],
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

    const tmnCode = this.requireConfigString(params.config.config['tmnCode'], 'tmnCode');
    const hashSecret = this.requireConfigString(params.config.secrets['hashSecret'], 'hashSecret');
    const paymentUrl =
      (typeof params.config.config['paymentUrl'] === 'string' &&
        params.config.config['paymentUrl'].trim()) ||
      VNPAY_DEFAULT_PAYMENT_URL;

    const now = new Date();
    const vnpParams: Record<string, string> = {
      vnp_Version: VNPAY_VERSION,
      vnp_Command: 'pay',
      vnp_TmnCode: tmnCode,
      vnp_Locale: params.locale.toLowerCase().startsWith('en') ? 'en' : 'vn',
      vnp_CurrCode: 'VND',
      vnp_TxnRef: params.paymentCode,
      vnp_OrderInfo: params.description.slice(0, 255),
      vnp_OrderType:
        (typeof params.config.config['orderType'] === 'string' &&
          params.config.config['orderType'].trim()) ||
        'other',
      vnp_Amount: String(params.amount * 100),
      vnp_ReturnUrl: params.returnUrl || 'https://localhost/payments/vnpay/return',
      vnp_IpAddr: params.customer?.ipAddress || '127.0.0.1',
      vnp_CreateDate: formatVnPayDateGmt7(now),
      vnp_ExpireDate: formatVnPayDateGmt7(params.expiresAt),
    };

    const signData = buildVnPayCanonicalQuery(vnpParams);
    const secureHash = hmacHex('sha512', hashSecret, signData);
    const checkoutUrl = `${paymentUrl}?${signData}&vnp_SecureHash=${secureHash}`;

    return {
      providerTransactionId: null,
      status: PAYMENT_TRANSACTION_STATUS.PENDING,
      checkoutUrl,
      qrPayload: null,
      rawResponse: {
        driver: this.driverCode,
        vnp_TxnRef: params.paymentCode,
        vnp_Amount: vnpParams['vnp_Amount'],
      },
    };
  }

  public async verifyCallback(
    params: AdapterVerifyCallbackParams,
  ): Promise<VerifiedPaymentCallback> {
    const hashSecret = params.config.secrets['hashSecret'] ?? '';
    const source = this.extractVnPayParams(params);
    const receivedHash = source['vnp_SecureHash'] ?? '';

    const signMap: Record<string, string> = {};
    for (const [key, val] of Object.entries(source)) {
      if (key === 'vnp_SecureHash' || key === 'vnp_SecureHashType') continue;
      if (key.startsWith('vnp_') && val !== '') {
        signMap[key] = val;
      }
    }

    const signData = buildVnPayCanonicalQuery(signMap);
    const signatureValid =
      Boolean(hashSecret) &&
      Boolean(receivedHash) &&
      verifyHmacHex({
        algorithm: 'sha512',
        secret: hashSecret,
        data: signData,
        expectedHex: receivedHash,
      });

    const paymentCode = source['vnp_TxnRef']?.trim() || null;
    const providerTransactionId = source['vnp_TransactionNo']?.trim() || null;
    const providerEventId =
      providerTransactionId || (receivedHash ? receivedHash.slice(0, 32) : null);

    if (!signatureValid) {
      return {
        signatureValid: false,
        rejectionCode: 'INVALID_VNP_SECURE_HASH',
        rejectionReason: 'VNPay vnp_SecureHash HMAC-SHA512 verification failed',
        providerEventId,
        providerTransactionId,
        paymentCode,
        merchantOrderRef: null,
        reportedStatus: null,
        reportedAmount: null,
        reportedCurrency: 'VND',
        paidAt: null,
        failureCode: 'INVALID_SIGNATURE',
        failureMessage: 'VNPay signature mismatch',
        normalizedPayload: source,
        ackBody: { RspCode: '97', Message: 'Invalid Signature' },
      };
    }

    const rawAmountNum = Number(source['vnp_Amount']);
    const reportedAmount =
      Number.isFinite(rawAmountNum) &&
      Number.isSafeInteger(rawAmountNum) &&
      rawAmountNum > 0 &&
      rawAmountNum % 100 === 0
        ? rawAmountNum / 100
        : null;

    const responseCode = source['vnp_ResponseCode'] ?? '';
    const txStatus = source['vnp_TransactionStatus'];
    let reportedStatus: PaymentTransactionStatusCode = PAYMENT_TRANSACTION_STATUS.FAILED;
    if (responseCode === '00' && (txStatus === undefined || txStatus === '00')) {
      reportedStatus = PAYMENT_TRANSACTION_STATUS.SUCCEEDED;
    } else if (responseCode === '24') {
      reportedStatus = PAYMENT_TRANSACTION_STATUS.CANCELLED;
    }

    const reportedCurrency = (source['vnp_CurrCode'] || 'VND').trim().toUpperCase();

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
      reportedCurrency,
      paidAt: reportedStatus === PAYMENT_TRANSACTION_STATUS.SUCCEEDED ? new Date() : null,
      failureCode:
        reportedStatus === PAYMENT_TRANSACTION_STATUS.SUCCEEDED ? null : responseCode || 'FAILED',
      failureMessage:
        reportedStatus === PAYMENT_TRANSACTION_STATUS.SUCCEEDED
          ? null
          : source['vnp_Message'] || `VNPay response code ${responseCode}`,
      normalizedPayload: source,
      ackBody: { RspCode: '00', Message: 'Confirm Success' },
    };
  }

  public async refund(params: AdapterRefundParams): Promise<AdapterRefundResult> {
    const tmnCode = this.requireConfigString(params.config.config['tmnCode'], 'tmnCode');
    const hashSecret = this.requireConfigString(params.config.secrets['hashSecret'], 'hashSecret');
    const apiUrl =
      (typeof params.config.config['apiUrl'] === 'string' &&
        params.config.config['apiUrl'].trim()) ||
      VNPAY_DEFAULT_API_URL;

    const requestId = params.refundCode.replace(/[^A-Za-z0-9]/g, '').slice(0, 32) || randomUUID();
    const txType = params.refundType === PAYMENT_REFUND_TYPE.FULL ? '02' : '03';
    const vnpAmount = String(params.refundAmount * 100);
    const transactionNo = params.providerTransactionId || '';
    const transactionDate = formatVnPayDateGmt7(params.paidAt ?? new Date());
    const createBy = params.actorIdentifier.slice(0, 64) || 'system';
    const createDate = formatVnPayDateGmt7(new Date());
    const ipAddr = '127.0.0.1';
    const orderInfo = (params.reason || `Refund ${params.paymentCode}`).slice(0, 255);

    const hashData = [
      requestId,
      VNPAY_VERSION,
      'refund',
      tmnCode,
      txType,
      params.paymentCode,
      vnpAmount,
      transactionNo,
      transactionDate,
      createBy,
      createDate,
      ipAddr,
      orderInfo,
    ].join('|');

    const secureHash = hmacHex('sha512', hashSecret, hashData);
    const payload = {
      vnp_RequestId: requestId,
      vnp_Version: VNPAY_VERSION,
      vnp_Command: 'refund',
      vnp_TmnCode: tmnCode,
      vnp_TransactionType: txType,
      vnp_TxnRef: params.paymentCode,
      vnp_Amount: vnpAmount,
      vnp_OrderInfo: orderInfo,
      ...(transactionNo ? { vnp_TransactionNo: transactionNo } : {}),
      vnp_TransactionDate: transactionDate,
      vnp_CreateBy: createBy,
      vnp_CreateDate: createDate,
      vnp_IpAddr: ipAddr,
      vnp_SecureHash: secureHash,
    };

    const res = await this.httpClient
      .forService('payment-vnpay')
      .post<Record<string, unknown>>(apiUrl, payload);

    const responseCode = String(res['vnp_ResponseCode'] ?? '');
    const success = responseCode === '00';
    return {
      status: success ? PAYMENT_REFUND_STATUS.SUCCEEDED : PAYMENT_REFUND_STATUS.FAILED,
      providerRefundId:
        typeof res['vnp_TransactionNo'] === 'string' && res['vnp_TransactionNo'].trim()
          ? res['vnp_TransactionNo'].trim()
          : requestId,
      refundedAt: success ? new Date() : null,
      failureCode: success ? null : responseCode || 'VNPAY_REFUND_FAILED',
      failureMessage: success
        ? null
        : typeof res['vnp_Message'] === 'string'
          ? res['vnp_Message']
          : `VNPay refund failed (${responseCode})`,
      rawResponse: res,
    };
  }

  public async queryTransaction(
    params: AdapterQueryTransactionParams,
  ): Promise<ProviderTransactionSnapshot | null> {
    const tmnCode = this.requireConfigString(params.config.config['tmnCode'], 'tmnCode');
    const hashSecret = this.requireConfigString(params.config.secrets['hashSecret'], 'hashSecret');
    const apiUrl =
      (typeof params.config.config['apiUrl'] === 'string' &&
        params.config.config['apiUrl'].trim()) ||
      VNPAY_DEFAULT_API_URL;

    const requestId = `Q${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const transactionDate = formatVnPayDateGmt7(params.createdAt);
    const createDate = formatVnPayDateGmt7(new Date());
    const ipAddr = '127.0.0.1';
    const orderInfo = `Query ${params.paymentCode}`;

    const hashData = [
      requestId,
      VNPAY_VERSION,
      'querydr',
      tmnCode,
      params.paymentCode,
      transactionDate,
      createDate,
      ipAddr,
      orderInfo,
    ].join('|');

    const secureHash = hmacHex('sha512', hashSecret, hashData);
    const res = await this.httpClient
      .forService('payment-vnpay')
      .post<Record<string, unknown>>(apiUrl, {
        vnp_RequestId: requestId,
        vnp_Version: VNPAY_VERSION,
        vnp_Command: 'querydr',
        vnp_TmnCode: tmnCode,
        vnp_TxnRef: params.paymentCode,
        vnp_OrderInfo: orderInfo,
        vnp_TransactionDate: transactionDate,
        vnp_CreateDate: createDate,
        vnp_IpAddr: ipAddr,
        vnp_SecureHash: secureHash,
      });

    const responseCode = String(res['vnp_ResponseCode'] ?? '');
    if (responseCode === '91') {
      return null;
    }

    const vnpTxStatus = String(res['vnp_TransactionStatus'] ?? '');
    let status: PaymentTransactionStatusCode = PAYMENT_TRANSACTION_STATUS.FAILED;
    if (responseCode === '00' && vnpTxStatus === '00') {
      status = PAYMENT_TRANSACTION_STATUS.SUCCEEDED;
    } else if (vnpTxStatus === '01') {
      status = PAYMENT_TRANSACTION_STATUS.PENDING;
    } else if (vnpTxStatus === '04') {
      status = PAYMENT_TRANSACTION_STATUS.CANCELLED;
    } else if (vnpTxStatus === '05' || vnpTxStatus === '06' || vnpTxStatus === '07') {
      status = PAYMENT_TRANSACTION_STATUS.PROCESSING;
    }

    const rawAmount = Number(res['vnp_Amount'] ?? 0);
    const amount =
      Number.isFinite(rawAmount) && rawAmount > 0 && rawAmount % 100 === 0
        ? rawAmount / 100
        : params.amount;

    return {
      providerCode: params.config.providerCode,
      paymentCode: params.paymentCode,
      merchantOrderRef: params.merchantOrderRef,
      providerTransactionId:
        typeof res['vnp_TransactionNo'] === 'string' && res['vnp_TransactionNo'].trim()
          ? res['vnp_TransactionNo'].trim()
          : params.providerTransactionId,
      status,
      amount,
      refundedAmount: 0,
      currency: 'VND',
      paidAt: status === PAYMENT_TRANSACTION_STATUS.SUCCEEDED ? params.createdAt : null,
      rawSnapshot: res,
    };
  }

  private extractVnPayParams(params: AdapterVerifyCallbackParams): Record<string, string> {
    const out: Record<string, string> = {};
    const collect = (obj: Record<string, unknown>) => {
      for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined && v !== null && k.startsWith('vnp_')) {
          out[k] = Array.isArray(v) ? String(v[0] ?? '') : String(v);
        }
      }
    };
    if (params.query && typeof params.query === 'object') {
      collect(params.query);
    }
    if (
      params.parsedBody &&
      typeof params.parsedBody === 'object' &&
      !Array.isArray(params.parsedBody)
    ) {
      collect(params.parsedBody as Record<string, unknown>);
    }
    return out;
  }

  private requireConfigString(val: unknown, field: string): string {
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

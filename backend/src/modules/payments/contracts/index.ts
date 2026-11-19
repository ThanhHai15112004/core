import type { PaginatedResult } from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type { PaymentDriverCode } from '../enum/payments.enum.js';
import type {
  AdapterCreatePaymentParams,
  AdapterCreatePaymentResult,
  AdapterQueryTransactionParams,
  AdapterRefundParams,
  AdapterRefundResult,
  AdapterVerifyCallbackParams,
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentDriverMetadata,
  PaymentProviderView,
  PaymentReconciliationView,
  PaymentTransactionView,
  ProviderTransactionSnapshot,
  ReceivePaymentCallbackInput,
  ReceivePaymentCallbackResult,
  RefundPaymentInput,
  RefundPaymentResult,
  RunReconciliationInput,
  VerifiedPaymentCallback,
} from '../types/payments.types.js';

export * from '../enum/payments.enum.js';
export * from '../types/payments.types.js';

export interface IPaymentProviderAdapter {
  readonly driverCode: PaymentDriverCode;
  getMetadata(): PaymentDriverMetadata;
  createPayment(params: AdapterCreatePaymentParams): Promise<AdapterCreatePaymentResult>;
  verifyCallback(params: AdapterVerifyCallbackParams): Promise<VerifiedPaymentCallback>;
  refund(params: AdapterRefundParams): Promise<AdapterRefundResult>;
  queryTransaction(
    params: AdapterQueryTransactionParams,
  ): Promise<ProviderTransactionSnapshot | null>;
}

export interface IPaymentsPublicService {
  listProviders(): Promise<PaymentProviderView[]>;
  createPayment(input: CreatePaymentInput, actor?: UserIdentity): Promise<CreatePaymentResult>;
  getTransactionById(id: number): Promise<PaymentTransactionView>;
  getTransactionByCode(paymentCode: string): Promise<PaymentTransactionView>;
  listTransactions(query?: {
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
    readonly providerCode?: string | undefined;
    readonly status?: number | undefined;
    readonly search?: string | undefined;
  }): Promise<PaginatedResult<PaymentTransactionView>>;
  refundPayment(
    transactionId: number,
    input: RefundPaymentInput,
    actor?: UserIdentity,
  ): Promise<RefundPaymentResult>;
  receiveCallback(input: ReceivePaymentCallbackInput): Promise<ReceivePaymentCallbackResult>;
  runReconciliation(
    input: RunReconciliationInput,
    actor?: UserIdentity,
  ): Promise<PaymentReconciliationView>;
}

export const PAYMENTS_PUBLIC_SERVICE = Symbol('PAYMENTS_PUBLIC_SERVICE');
export const PAYMENT_ADAPTER_REGISTRY = Symbol('PAYMENT_ADAPTER_REGISTRY');

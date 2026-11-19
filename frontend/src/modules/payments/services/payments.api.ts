import { fetchApi, fetchApiWithMeta } from '../../../core/services/api';
import { API_ROUTES } from '../../../routes/api.routes';
import type {
  CreatePaymentResult,
  PaymentCallbackItem,
  PaymentDriverMetadata,
  PaymentProviderItem,
  PaymentReconciliationItem,
  PaymentReconciliationLineItem,
  PaymentReconciliationResolveAction,
  PaymentTransactionItem,
  ReceivePaymentCallbackResult,
  RefundPaymentResult,
} from '../types/payments.types';

export const paymentsApi = {
  listDrivers: (): Promise<PaymentDriverMetadata[]> =>
    fetchApi<PaymentDriverMetadata[]>(API_ROUTES.PAYMENTS.DRIVERS),

  listProviders: (qs = '') =>
    fetchApiWithMeta<PaymentProviderItem[]>(API_ROUTES.PAYMENTS.PROVIDERS(qs)),

  createProvider: (payload: Record<string, unknown>): Promise<PaymentProviderItem> =>
    fetchApi<PaymentProviderItem>(API_ROUTES.PAYMENTS.PROVIDERS(), {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateProvider: (
    id: number | string,
    payload: Record<string, unknown>,
  ): Promise<PaymentProviderItem> =>
    fetchApi<PaymentProviderItem>(API_ROUTES.PAYMENTS.PROVIDER_BY_ID(id), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  deleteProvider: (id: number | string): Promise<{ deleted: true; id: number }> =>
    fetchApi<{ deleted: true; id: number }>(API_ROUTES.PAYMENTS.PROVIDER_BY_ID(id), {
      method: 'DELETE',
    }),

  listTransactions: (qs = '') =>
    fetchApiWithMeta<PaymentTransactionItem[]>(API_ROUTES.PAYMENTS.TRANSACTIONS(qs)),

  getTransactionById: (id: number | string): Promise<PaymentTransactionItem> =>
    fetchApi<PaymentTransactionItem>(API_ROUTES.PAYMENTS.TRANSACTION_BY_ID(id)),

  createPayment: (
    payload: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<CreatePaymentResult> =>
    fetchApi<CreatePaymentResult>(API_ROUTES.PAYMENTS.TRANSACTIONS(), {
      method: 'POST',
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      body: JSON.stringify(payload),
    }),

  refundPayment: (
    transactionId: number | string,
    payload: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<RefundPaymentResult> =>
    fetchApi<RefundPaymentResult>(API_ROUTES.PAYMENTS.TRANSACTION_REFUNDS(transactionId), {
      method: 'POST',
      headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined,
      body: JSON.stringify(payload),
    }),

  simulateSandboxCallback: (
    transactionId: number | string,
    payload: Record<string, unknown>,
  ): Promise<ReceivePaymentCallbackResult> =>
    fetchApi<ReceivePaymentCallbackResult>(
      API_ROUTES.PAYMENTS.TRANSACTION_SIMULATE_CALLBACK(transactionId),
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),

  listCallbacks: (qs = '') =>
    fetchApiWithMeta<PaymentCallbackItem[]>(API_ROUTES.PAYMENTS.CALLBACKS(qs)),

  listReconciliations: (qs = '') =>
    fetchApiWithMeta<PaymentReconciliationItem[]>(API_ROUTES.PAYMENTS.RECONCILIATIONS(qs)),

  getReconciliationById: (id: number | string, qs = ''): Promise<PaymentReconciliationItem> =>
    fetchApi<PaymentReconciliationItem>(API_ROUTES.PAYMENTS.RECONCILIATION_BY_ID(id, qs)),

  runReconciliation: (payload: Record<string, unknown>): Promise<PaymentReconciliationItem> =>
    fetchApi<PaymentReconciliationItem>(API_ROUTES.PAYMENTS.RECONCILIATION_RUN, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  resolveReconciliationItem: (
    reconciliationId: number | string,
    itemId: number | string,
    payload: { action: PaymentReconciliationResolveAction; note?: string },
  ): Promise<PaymentReconciliationLineItem> =>
    fetchApi<PaymentReconciliationLineItem>(
      API_ROUTES.PAYMENTS.RECONCILIATION_RESOLVE_ITEM(reconciliationId, itemId),
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
    ),
};

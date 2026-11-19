export const PAYMENTS_ROUTES = {
  PREFIX: 'payments',
  DRIVERS: 'drivers',
  PROVIDERS: 'providers',
  PROVIDER_BY_ID: 'providers/:id',
  TRANSACTIONS: 'transactions',
  TRANSACTION_BY_ID: 'transactions/:id',
  TRANSACTION_REFUNDS: 'transactions/:id/refunds',
  TRANSACTION_SIMULATE_CALLBACK: 'transactions/:id/simulate-callback',
  REFUNDS: 'refunds',
  CALLBACKS: 'callbacks',
  CALLBACK_BY_ID: 'callbacks/:id',
  CALLBACK_RECEIVE: 'callbacks/:providerCode',
  RECONCILIATIONS: 'reconciliations',
  RECONCILIATION_RUN: 'reconciliations/run',
  RECONCILIATION_BY_ID: 'reconciliations/:id',
  RECONCILIATION_RESOLVE_ITEM: 'reconciliations/:id/items/:itemId/resolve',
  buildCallbackPath(providerCode: string): string {
    return `/api/v1/payments/callbacks/${encodeURIComponent(providerCode)}`;
  },
} as const;

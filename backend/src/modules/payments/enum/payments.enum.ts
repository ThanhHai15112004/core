export const PAYMENT_DRIVER_CODE = {
  SANDBOX: 'sandbox',
  VNPAY: 'vnpay',
  MOMO: 'momo',
  STRIPE: 'stripe',
} as const;

export type PaymentDriverCode = (typeof PAYMENT_DRIVER_CODE)[keyof typeof PAYMENT_DRIVER_CODE];

export const PAYMENT_PROVIDER_STATUS = {
  ACTIVE: 1,
  INACTIVE: 2,
} as const;

export type PaymentProviderStatusCode =
  (typeof PAYMENT_PROVIDER_STATUS)[keyof typeof PAYMENT_PROVIDER_STATUS];

export const PAYMENT_ENVIRONMENT = {
  SANDBOX: 'SANDBOX',
  PRODUCTION: 'PRODUCTION',
} as const;

export type PaymentEnvironment = (typeof PAYMENT_ENVIRONMENT)[keyof typeof PAYMENT_ENVIRONMENT];

export const PAYMENT_TRANSACTION_STATUS = {
  PENDING: 1,
  PROCESSING: 2,
  SUCCEEDED: 3,
  FAILED: 4,
  CANCELLED: 5,
  EXPIRED: 6,
  PARTIALLY_REFUNDED: 7,
  REFUNDED: 8,
} as const;

export type PaymentTransactionStatusCode =
  (typeof PAYMENT_TRANSACTION_STATUS)[keyof typeof PAYMENT_TRANSACTION_STATUS];

export const PAYMENT_REFUND_STATUS = {
  PENDING: 1,
  PROCESSING: 2,
  SUCCEEDED: 3,
  FAILED: 4,
  CANCELLED: 5,
} as const;

export type PaymentRefundStatusCode =
  (typeof PAYMENT_REFUND_STATUS)[keyof typeof PAYMENT_REFUND_STATUS];

export const PAYMENT_REFUND_TYPE = {
  FULL: 'FULL',
  PARTIAL: 'PARTIAL',
} as const;

export type PaymentRefundType = (typeof PAYMENT_REFUND_TYPE)[keyof typeof PAYMENT_REFUND_TYPE];

export const PAYMENT_CALLBACK_STATUS = {
  VERIFIED: 1,
  DUPLICATE: 2,
  INVALID_SIGNATURE: 3,
  AMOUNT_MISMATCH: 4,
  CURRENCY_MISMATCH: 5,
  TRANSACTION_NOT_FOUND: 6,
  REJECTED: 7,
  ERROR: 8,
} as const;

export type PaymentCallbackStatusCode =
  (typeof PAYMENT_CALLBACK_STATUS)[keyof typeof PAYMENT_CALLBACK_STATUS];

export const PAYMENT_RECONCILIATION_SOURCE = {
  LIVE_QUERY: 'LIVE_QUERY',
  STATEMENT: 'STATEMENT',
} as const;

export type PaymentReconciliationSource =
  (typeof PAYMENT_RECONCILIATION_SOURCE)[keyof typeof PAYMENT_RECONCILIATION_SOURCE];

export const PAYMENT_RECONCILIATION_RUN_STATUS = {
  RUNNING: 1,
  COMPLETED: 2,
  FAILED: 3,
} as const;

export type PaymentReconciliationRunStatusCode =
  (typeof PAYMENT_RECONCILIATION_RUN_STATUS)[keyof typeof PAYMENT_RECONCILIATION_RUN_STATUS];

export const PAYMENT_RECONCILIATION_DISCREPANCY = {
  MATCHED: 1,
  STATUS_MISMATCH: 2,
  AMOUNT_MISMATCH: 3,
  REFUND_MISMATCH: 4,
  MISSING_AT_PROVIDER: 5,
  MISSING_INTERNALLY: 6,
} as const;

export type PaymentReconciliationDiscrepancyCode =
  (typeof PAYMENT_RECONCILIATION_DISCREPANCY)[keyof typeof PAYMENT_RECONCILIATION_DISCREPANCY];

export const PAYMENT_RECONCILIATION_RESOLUTION = {
  OPEN: 1,
  RESOLVED: 2,
  IGNORED: 3,
} as const;

export type PaymentReconciliationResolutionCode =
  (typeof PAYMENT_RECONCILIATION_RESOLUTION)[keyof typeof PAYMENT_RECONCILIATION_RESOLUTION];

export const PAYMENT_RECONCILIATION_RESOLVE_ACTION = {
  SYNC_FROM_PROVIDER: 'SYNC_FROM_PROVIDER',
  MARK_RESOLVED: 'MARK_RESOLVED',
  IGNORE: 'IGNORE',
} as const;

export type PaymentReconciliationResolveAction =
  (typeof PAYMENT_RECONCILIATION_RESOLVE_ACTION)[keyof typeof PAYMENT_RECONCILIATION_RESOLVE_ACTION];

export const PAYMENT_SETTING_KEYS = {
  DEFAULT_CURRENCY: 'payments.default_currency',
  DEFAULT_EXPIRY_SECONDS: 'payments.default_expiry_seconds',
  CALLBACK_TOLERANCE_SEC: 'payments.callback_tolerance_sec',
  MAX_STORED_PAYLOAD_BYTES: 'payments.max_stored_payload_bytes',
  RECORD_REJECTED_CALLBACKS: 'payments.record_rejected_callbacks',
  RECONCILE_MAX_LIVE_QUERIES: 'payments.reconcile_max_live_queries',
} as const;

export const PAYMENT_SEQUENCE_KEYS = {
  TRANSACTION_CODE: 'payments.transaction_code',
  REFUND_CODE: 'payments.refund_code',
  RECONCILIATION_CODE: 'payments.reconciliation_code',
} as const;

export const PAYMENT_AUDIT_META = {
  MODULE: 'payments',
  FEATURES: {
    PROVIDERS: 'providers',
    TRANSACTIONS: 'transactions',
    CALLBACKS: 'callbacks',
    REFUNDS: 'refunds',
    RECONCILIATION: 'reconciliation',
  },
} as const;

export const PAYMENT_EVENTS = {
  PROVIDER_UPDATED: 'payments.provider.updated',
  TRANSACTION_CREATED: 'payments.transaction.created',
  TRANSACTION_SUCCEEDED: 'payments.transaction.succeeded',
  TRANSACTION_FAILED: 'payments.transaction.failed',
  TRANSACTION_CANCELLED: 'payments.transaction.cancelled',
  REFUND_SUCCEEDED: 'payments.refund.succeeded',
  REFUND_FAILED: 'payments.refund.failed',
  CALLBACK_REJECTED: 'payments.callback.rejected',
  RECONCILIATION_COMPLETED: 'payments.reconciliation.completed',
} as const;

export const PAYMENT_DEFAULTS = {
  DEFAULT_CURRENCY: 'VND',
  DEFAULT_EXPIRY_SECONDS: 900,
  CALLBACK_TOLERANCE_SEC: 300,
  MAX_STORED_PAYLOAD_BYTES: 65_536,
  RECORD_REJECTED_CALLBACKS: true,
  RECONCILE_MAX_LIVE_QUERIES: 100,
  SANDBOX_CHECKOUT_BASE_URL: 'https://sandbox.payments.local/checkout',
} as const;

export function getPaymentProviderStatusName(status: number): string {
  return status === PAYMENT_PROVIDER_STATUS.ACTIVE ? 'ACTIVE' : 'INACTIVE';
}

export function getPaymentTransactionStatusName(status: number): string {
  switch (status) {
    case PAYMENT_TRANSACTION_STATUS.PENDING:
      return 'PENDING';
    case PAYMENT_TRANSACTION_STATUS.PROCESSING:
      return 'PROCESSING';
    case PAYMENT_TRANSACTION_STATUS.SUCCEEDED:
      return 'SUCCEEDED';
    case PAYMENT_TRANSACTION_STATUS.FAILED:
      return 'FAILED';
    case PAYMENT_TRANSACTION_STATUS.CANCELLED:
      return 'CANCELLED';
    case PAYMENT_TRANSACTION_STATUS.EXPIRED:
      return 'EXPIRED';
    case PAYMENT_TRANSACTION_STATUS.PARTIALLY_REFUNDED:
      return 'PARTIALLY_REFUNDED';
    case PAYMENT_TRANSACTION_STATUS.REFUNDED:
      return 'REFUNDED';
    default:
      return 'UNKNOWN';
  }
}

export function getPaymentRefundStatusName(status: number): string {
  switch (status) {
    case PAYMENT_REFUND_STATUS.PENDING:
      return 'PENDING';
    case PAYMENT_REFUND_STATUS.PROCESSING:
      return 'PROCESSING';
    case PAYMENT_REFUND_STATUS.SUCCEEDED:
      return 'SUCCEEDED';
    case PAYMENT_REFUND_STATUS.FAILED:
      return 'FAILED';
    case PAYMENT_REFUND_STATUS.CANCELLED:
      return 'CANCELLED';
    default:
      return 'UNKNOWN';
  }
}

export function getPaymentCallbackStatusName(status: number): string {
  switch (status) {
    case PAYMENT_CALLBACK_STATUS.VERIFIED:
      return 'VERIFIED';
    case PAYMENT_CALLBACK_STATUS.DUPLICATE:
      return 'DUPLICATE';
    case PAYMENT_CALLBACK_STATUS.INVALID_SIGNATURE:
      return 'INVALID_SIGNATURE';
    case PAYMENT_CALLBACK_STATUS.AMOUNT_MISMATCH:
      return 'AMOUNT_MISMATCH';
    case PAYMENT_CALLBACK_STATUS.CURRENCY_MISMATCH:
      return 'CURRENCY_MISMATCH';
    case PAYMENT_CALLBACK_STATUS.TRANSACTION_NOT_FOUND:
      return 'TRANSACTION_NOT_FOUND';
    case PAYMENT_CALLBACK_STATUS.REJECTED:
      return 'REJECTED';
    case PAYMENT_CALLBACK_STATUS.ERROR:
      return 'ERROR';
    default:
      return 'UNKNOWN';
  }
}

export function getPaymentDiscrepancyName(status: number): string {
  switch (status) {
    case PAYMENT_RECONCILIATION_DISCREPANCY.MATCHED:
      return 'MATCHED';
    case PAYMENT_RECONCILIATION_DISCREPANCY.STATUS_MISMATCH:
      return 'STATUS_MISMATCH';
    case PAYMENT_RECONCILIATION_DISCREPANCY.AMOUNT_MISMATCH:
      return 'AMOUNT_MISMATCH';
    case PAYMENT_RECONCILIATION_DISCREPANCY.REFUND_MISMATCH:
      return 'REFUND_MISMATCH';
    case PAYMENT_RECONCILIATION_DISCREPANCY.MISSING_AT_PROVIDER:
      return 'MISSING_AT_PROVIDER';
    case PAYMENT_RECONCILIATION_DISCREPANCY.MISSING_INTERNALLY:
      return 'MISSING_INTERNALLY';
    default:
      return 'UNKNOWN';
  }
}

export function getPaymentResolutionStatusName(status: number): string {
  switch (status) {
    case PAYMENT_RECONCILIATION_RESOLUTION.OPEN:
      return 'OPEN';
    case PAYMENT_RECONCILIATION_RESOLUTION.RESOLVED:
      return 'RESOLVED';
    case PAYMENT_RECONCILIATION_RESOLUTION.IGNORED:
      return 'IGNORED';
    default:
      return 'UNKNOWN';
  }
}

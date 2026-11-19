import { z } from 'zod';
import {
  booleanQueryParam,
  createPaginationQuerySchema,
  optionalQueryParam,
} from '@packages/http/index.js';
import {
  PAYMENT_DRIVER_CODE,
  PAYMENT_ENVIRONMENT,
  PAYMENT_PROVIDER_STATUS,
  PAYMENT_RECONCILIATION_DISCREPANCY,
  PAYMENT_RECONCILIATION_RESOLUTION,
  PAYMENT_RECONCILIATION_RESOLVE_ACTION,
  PAYMENT_RECONCILIATION_SOURCE,
  PAYMENT_TRANSACTION_STATUS,
  type PaymentDriverCode,
  type PaymentProviderStatusCode,
  type PaymentReconciliationSource,
  type PaymentTransactionStatusCode,
} from '../enum/payments.enum.js';

const PROVIDER_CODE_REGEX = /^[a-z0-9][a-z0-9-_]{1,63}$/;
const CURRENCY_REGEX = /^[A-Za-z]{3}$/;

function parseProviderStatus(val: unknown): unknown {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const clean = val.trim().toUpperCase();
    if (clean === '1' || clean === 'ACTIVE') return PAYMENT_PROVIDER_STATUS.ACTIVE;
    if (clean === '2' || clean === 'INACTIVE') return PAYMENT_PROVIDER_STATUS.INACTIVE;
  }
  return val;
}

function parseTransactionStatus(val: unknown): unknown {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const clean = val.trim().toUpperCase();
    if (clean === '1' || clean === 'PENDING') return PAYMENT_TRANSACTION_STATUS.PENDING;
    if (clean === '2' || clean === 'PROCESSING') return PAYMENT_TRANSACTION_STATUS.PROCESSING;
    if (clean === '3' || clean === 'SUCCEEDED') return PAYMENT_TRANSACTION_STATUS.SUCCEEDED;
    if (clean === '4' || clean === 'FAILED') return PAYMENT_TRANSACTION_STATUS.FAILED;
    if (clean === '5' || clean === 'CANCELLED') return PAYMENT_TRANSACTION_STATUS.CANCELLED;
    if (clean === '6' || clean === 'EXPIRED') return PAYMENT_TRANSACTION_STATUS.EXPIRED;
    if (clean === '7' || clean === 'PARTIALLY_REFUNDED') {
      return PAYMENT_TRANSACTION_STATUS.PARTIALLY_REFUNDED;
    }
    if (clean === '8' || clean === 'REFUNDED') return PAYMENT_TRANSACTION_STATUS.REFUNDED;
  }
  return val;
}

export const paymentProviderCodeParamSchema = z.object({
  providerCode: z
    .string()
    .trim()
    .toLowerCase()
    .regex(PROVIDER_CODE_REGEX, 'providerCode must be 2-64 chars [a-z0-9-_]'),
});

export const reconciliationItemParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  itemId: z.coerce.number().int().positive(),
});

export const PaymentDriverCodeSchema = z.enum([
  PAYMENT_DRIVER_CODE.SANDBOX,
  PAYMENT_DRIVER_CODE.VNPAY,
  PAYMENT_DRIVER_CODE.MOMO,
  PAYMENT_DRIVER_CODE.STRIPE,
]);

export const PaymentEnvironmentSchema = z.enum([
  PAYMENT_ENVIRONMENT.SANDBOX,
  PAYMENT_ENVIRONMENT.PRODUCTION,
]);

export const PaymentProviderStatusSchema = z.preprocess(
  parseProviderStatus,
  z.union([z.literal(PAYMENT_PROVIDER_STATUS.ACTIVE), z.literal(PAYMENT_PROVIDER_STATUS.INACTIVE)]),
);

export const PaymentTransactionStatusSchema = z.preprocess(
  parseTransactionStatus,
  z.union([
    z.literal(PAYMENT_TRANSACTION_STATUS.PENDING),
    z.literal(PAYMENT_TRANSACTION_STATUS.PROCESSING),
    z.literal(PAYMENT_TRANSACTION_STATUS.SUCCEEDED),
    z.literal(PAYMENT_TRANSACTION_STATUS.FAILED),
    z.literal(PAYMENT_TRANSACTION_STATUS.CANCELLED),
    z.literal(PAYMENT_TRANSACTION_STATUS.EXPIRED),
    z.literal(PAYMENT_TRANSACTION_STATUS.PARTIALLY_REFUNDED),
    z.literal(PAYMENT_TRANSACTION_STATUS.REFUNDED),
  ]),
);

export const CreatePaymentProviderRequestSchema = z.object({
  providerCode: z
    .string()
    .trim()
    .toLowerCase()
    .regex(PROVIDER_CODE_REGEX, 'providerCode must be 2-64 chars [a-z0-9-_]'),
  driverCode: PaymentDriverCodeSchema,
  displayName: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  status: PaymentProviderStatusSchema.optional().default(PAYMENT_PROVIDER_STATUS.ACTIVE),
  isEnabled: z.boolean().optional().default(true),
  isDefault: z.boolean().optional().default(false),
  environment: PaymentEnvironmentSchema.optional().default(PAYMENT_ENVIRONMENT.SANDBOX),
  supportsPartialRefund: z.boolean().optional().default(true),
  allowedCurrencies: z
    .array(
      z
        .string()
        .trim()
        .regex(CURRENCY_REGEX)
        .transform((v) => v.toUpperCase()),
    )
    .max(20)
    .optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  secrets: z.record(z.string(), z.string().min(1)).optional(),
});

export type CreatePaymentProviderRequest = z.infer<typeof CreatePaymentProviderRequestSchema>;

export const UpdatePaymentProviderRequestSchema = z.object({
  displayName: z.string().trim().min(2).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  status: PaymentProviderStatusSchema.optional(),
  isEnabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  environment: PaymentEnvironmentSchema.optional(),
  supportsPartialRefund: z.boolean().optional(),
  allowedCurrencies: z
    .array(
      z
        .string()
        .trim()
        .regex(CURRENCY_REGEX)
        .transform((v) => v.toUpperCase()),
    )
    .max(20)
    .optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  secrets: z.record(z.string(), z.string().min(1)).optional(),
});

export type UpdatePaymentProviderRequest = z.infer<typeof UpdatePaymentProviderRequestSchema>;

export const ListPaymentProvidersQuerySchema = createPaginationQuerySchema().and(
  z.object({
    driverCode: optionalQueryParam(PaymentDriverCodeSchema) as z.ZodType<
      PaymentDriverCode | undefined
    >,
    status: optionalQueryParam(PaymentProviderStatusSchema) as z.ZodType<
      PaymentProviderStatusCode | undefined
    >,
    isEnabled: booleanQueryParam(),
    search: optionalQueryParam(z.string().trim().max(120)),
  }),
);

export type ListPaymentProvidersQuery = z.infer<typeof ListPaymentProvidersQuerySchema>;

export const CreatePaymentRequestSchema = z.object({
  providerCode: z.string().trim().toLowerCase().regex(PROVIDER_CODE_REGEX).optional(),
  idempotencyKey: z.string().trim().min(4).max(160).optional(),
  merchantOrderRef: z.string().trim().min(1).max(128),
  amount: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z
    .string()
    .trim()
    .regex(CURRENCY_REGEX, 'Currency must be 3-letter ISO 4217 code')
    .transform((v) => v.toUpperCase())
    .optional(),
  description: z.string().trim().max(500).optional(),
  returnUrl: z.string().trim().url().max(1000).optional(),
  cancelUrl: z.string().trim().url().max(1000).optional(),
  locale: z.string().trim().min(2).max(16).optional(),
  expiresInSeconds: z.coerce.number().int().min(60).max(86_400).optional(),
  customer: z
    .object({
      name: z.string().trim().max(120).optional(),
      email: z.string().trim().email().max(255).optional(),
      phone: z.string().trim().max(32).optional(),
      ipAddress: z.string().trim().max(64).optional(),
    })
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  organizationUnitId: z.coerce.number().int().positive().nullable().optional(),
});

export type CreatePaymentRequest = z.infer<typeof CreatePaymentRequestSchema>;

export const ListPaymentTransactionsQuerySchema = createPaginationQuerySchema().and(
  z.object({
    providerCode: optionalQueryParam(z.string().trim().toLowerCase().max(64)),
    status: optionalQueryParam(PaymentTransactionStatusSchema) as z.ZodType<
      PaymentTransactionStatusCode | undefined
    >,
    currency: optionalQueryParam(z.string().trim().max(8)),
    merchantOrderRef: optionalQueryParam(z.string().trim().max(128)),
    search: optionalQueryParam(z.string().trim().max(120)),
    from: optionalQueryParam(z.string().trim()),
    to: optionalQueryParam(z.string().trim()),
  }),
);

export type ListPaymentTransactionsQuery = z.infer<typeof ListPaymentTransactionsQuerySchema>;

export const RefundPaymentRequestSchema = z.object({
  idempotencyKey: z.string().trim().min(4).max(160).optional(),
  amount: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  reason: z.string().trim().max(500).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RefundPaymentRequest = z.infer<typeof RefundPaymentRequestSchema>;

export const ListPaymentRefundsQuerySchema = createPaginationQuerySchema().and(
  z.object({
    paymentTransactionId: optionalQueryParam(z.coerce.number().int().positive()),
    providerCode: optionalQueryParam(z.string().trim().toLowerCase().max(64)),
    status: optionalQueryParam(z.coerce.number().int().min(1).max(5)) as z.ZodType<
      1 | 2 | 3 | 4 | 5 | undefined
    >,
    search: optionalQueryParam(z.string().trim().max(120)),
  }),
);

export type ListPaymentRefundsQuery = z.infer<typeof ListPaymentRefundsQuerySchema>;

export const SimulatePaymentCallbackRequestSchema = z.object({
  status: PaymentTransactionStatusSchema.optional().default(PAYMENT_TRANSACTION_STATUS.SUCCEEDED),
  amount: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  currency: z
    .string()
    .trim()
    .regex(CURRENCY_REGEX)
    .transform((v) => v.toUpperCase())
    .optional(),
  eventId: z.string().trim().max(160).optional(),
  tamperSignature: z.boolean().optional().default(false),
  failureCode: z.string().trim().max(80).optional(),
  failureMessage: z.string().trim().max(500).optional(),
});

export type SimulatePaymentCallbackRequest = z.infer<typeof SimulatePaymentCallbackRequestSchema>;

export const ListPaymentCallbacksQuerySchema = createPaginationQuerySchema().and(
  z.object({
    providerCode: optionalQueryParam(z.string().trim().toLowerCase().max(64)),
    paymentTransactionId: optionalQueryParam(z.coerce.number().int().positive()),
    verificationStatus: optionalQueryParam(z.coerce.number().int().min(1).max(8)) as z.ZodType<
      1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | undefined
    >,
    search: optionalQueryParam(z.string().trim().max(120)),
  }),
);

export type ListPaymentCallbacksQuery = z.infer<typeof ListPaymentCallbacksQuerySchema>;

const ProviderStatementRecordSchema = z.object({
  paymentCode: z.string().trim().max(64).optional(),
  merchantOrderRef: z.string().trim().max(128).optional(),
  providerTransactionId: z.string().trim().max(180).optional(),
  status: z.union([z.number().int(), z.string().trim().min(1)]),
  amount: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  refundedAmount: z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  currency: z
    .string()
    .trim()
    .regex(CURRENCY_REGEX)
    .transform((v) => v.toUpperCase()),
  paidAt: z.string().trim().optional(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

export const RunPaymentReconciliationRequestSchema = z.object({
  providerCode: z.string().trim().toLowerCase().regex(PROVIDER_CODE_REGEX),
  sourceMode: z.enum([
    PAYMENT_RECONCILIATION_SOURCE.LIVE_QUERY,
    PAYMENT_RECONCILIATION_SOURCE.STATEMENT,
  ]),
  periodStart: z.string().trim().min(8),
  periodEnd: z.string().trim().min(8),
  statementItems: z.array(ProviderStatementRecordSchema).max(5000).optional(),
  statementCsv: z.string().max(2_000_000).optional(),
});

export type RunPaymentReconciliationRequest = z.infer<typeof RunPaymentReconciliationRequestSchema>;

export const ListPaymentReconciliationsQuerySchema = createPaginationQuerySchema().and(
  z.object({
    providerCode: optionalQueryParam(z.string().trim().toLowerCase().max(64)),
    sourceMode: optionalQueryParam(
      z.enum([PAYMENT_RECONCILIATION_SOURCE.LIVE_QUERY, PAYMENT_RECONCILIATION_SOURCE.STATEMENT]),
    ) as z.ZodType<PaymentReconciliationSource | undefined>,
    status: optionalQueryParam(z.coerce.number().int().min(1).max(3)) as z.ZodType<
      1 | 2 | 3 | undefined
    >,
  }),
);

export type ListPaymentReconciliationsQuery = z.infer<typeof ListPaymentReconciliationsQuerySchema>;

export const GetReconciliationDetailQuerySchema = z.object({
  discrepancyStatus: optionalQueryParam(
    z.coerce
      .number()
      .int()
      .min(PAYMENT_RECONCILIATION_DISCREPANCY.MATCHED)
      .max(PAYMENT_RECONCILIATION_DISCREPANCY.MISSING_INTERNALLY),
  ),
  resolutionStatus: optionalQueryParam(
    z.coerce
      .number()
      .int()
      .min(PAYMENT_RECONCILIATION_RESOLUTION.OPEN)
      .max(PAYMENT_RECONCILIATION_RESOLUTION.IGNORED),
  ),
});

export type GetReconciliationDetailQuery = z.infer<typeof GetReconciliationDetailQuerySchema>;

export const ResolveReconciliationItemRequestSchema = z.object({
  action: z.enum([
    PAYMENT_RECONCILIATION_RESOLVE_ACTION.SYNC_FROM_PROVIDER,
    PAYMENT_RECONCILIATION_RESOLVE_ACTION.MARK_RESOLVED,
    PAYMENT_RECONCILIATION_RESOLVE_ACTION.IGNORE,
  ]),
  note: z.string().trim().max(500).optional(),
});

export type ResolveReconciliationItemRequest = z.infer<
  typeof ResolveReconciliationItemRequestSchema
>;

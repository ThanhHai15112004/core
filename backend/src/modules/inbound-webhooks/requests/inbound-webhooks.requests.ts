import { z } from 'zod';
import { createPaginationQuerySchema, optionalQueryParam } from '@packages/http/index.js';
import {
  INBOUND_WEBHOOK_AUTH_TYPE,
  INBOUND_WEBHOOK_DEFAULTS,
  INBOUND_WEBHOOK_EVENT_STATUS,
  INBOUND_WEBHOOK_PROVIDER_STATUS,
  INBOUND_WEBHOOK_SIGNATURE_FORMAT,
  type InboundWebhookEventStatusCode,
  type InboundWebhookProviderStatusCode,
} from '../enum/inbound-webhooks.enum.js';

const PROVIDER_CODE_REGEX = /^[a-z0-9][a-z0-9-_]{1,63}$/;
const HEADER_NAME_REGEX = /^[a-zA-Z0-9-]+$/;

function parseProviderStatus(val: unknown): unknown {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const clean = val.trim().toUpperCase();
    if (clean === '1' || clean === 'ACTIVE') return INBOUND_WEBHOOK_PROVIDER_STATUS.ACTIVE;
    if (clean === '2' || clean === 'PAUSED') return INBOUND_WEBHOOK_PROVIDER_STATUS.PAUSED;
  }
  return val;
}

function parseEventStatus(val: unknown): unknown {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const clean = val.trim().toUpperCase();
    if (clean === '1' || clean === 'QUEUED') return INBOUND_WEBHOOK_EVENT_STATUS.QUEUED;
    if (clean === '2' || clean === 'PROCESSING') return INBOUND_WEBHOOK_EVENT_STATUS.PROCESSING;
    if (clean === '3' || clean === 'PROCESSED') return INBOUND_WEBHOOK_EVENT_STATUS.PROCESSED;
    if (clean === '4' || clean === 'FAILED') return INBOUND_WEBHOOK_EVENT_STATUS.FAILED;
    if (clean === '5' || clean === 'REJECTED') return INBOUND_WEBHOOK_EVENT_STATUS.REJECTED;
  }
  return val;
}

export const providerCodeParamSchema = z.object({
  providerCode: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      PROVIDER_CODE_REGEX,
      'providerCode must be lowercase alphanumeric with hyphens/underscores (2-64 chars)',
    ),
});

export const InboundWebhookProviderStatusSchema = z.preprocess(
  parseProviderStatus,
  z.union([
    z.literal(INBOUND_WEBHOOK_PROVIDER_STATUS.ACTIVE),
    z.literal(INBOUND_WEBHOOK_PROVIDER_STATUS.PAUSED),
  ]),
);

export const InboundWebhookEventStatusSchema = z.preprocess(
  parseEventStatus,
  z.union([
    z.literal(INBOUND_WEBHOOK_EVENT_STATUS.QUEUED),
    z.literal(INBOUND_WEBHOOK_EVENT_STATUS.PROCESSING),
    z.literal(INBOUND_WEBHOOK_EVENT_STATUS.PROCESSED),
    z.literal(INBOUND_WEBHOOK_EVENT_STATUS.FAILED),
    z.literal(INBOUND_WEBHOOK_EVENT_STATUS.REJECTED),
  ]),
);

const AuthTypeSchema = z.enum([
  INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256,
  INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA512,
  INBOUND_WEBHOOK_AUTH_TYPE.STATIC_TOKEN,
]);

const SignatureFormatSchema = z.enum([
  INBOUND_WEBHOOK_SIGNATURE_FORMAT.TIMESTAMP_DOT_BODY,
  INBOUND_WEBHOOK_SIGNATURE_FORMAT.RAW_BODY,
]);

const HeaderNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(HEADER_NAME_REGEX, 'Header name must contain only alphanumeric characters and hyphens');

const SensitiveFieldsSchema = z.array(z.string().trim().min(1).max(120)).max(100);

export const CreateInboundWebhookProviderRequestSchema = z.object({
  providerCode: z
    .string()
    .trim()
    .toLowerCase()
    .regex(PROVIDER_CODE_REGEX, 'providerCode must be 2-64 chars [a-z0-9-_]'),
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().max(500).nullable().optional(),
  status: InboundWebhookProviderStatusSchema.optional().default(
    INBOUND_WEBHOOK_PROVIDER_STATUS.ACTIVE,
  ),
  authType: AuthTypeSchema.optional().default(INBOUND_WEBHOOK_AUTH_TYPE.HMAC_SHA256),
  signingSecret: z.string().min(8).max(500).optional(),
  signatureHeader: HeaderNameSchema.optional().default(INBOUND_WEBHOOK_DEFAULTS.SIGNATURE_HEADER),
  signaturePrefix: z.string().max(32).nullable().optional(),
  signatureFormat: SignatureFormatSchema.optional(),
  timestampHeader: HeaderNameSchema.optional().default(INBOUND_WEBHOOK_DEFAULTS.TIMESTAMP_HEADER),
  requireTimestamp: z.boolean().optional(),
  toleranceSec: z.coerce.number().int().min(10).max(86_400).optional(),
  eventIdHeader: HeaderNameSchema.optional().default(INBOUND_WEBHOOK_DEFAULTS.EVENT_ID_HEADER),
  eventIdPayloadPath: z
    .string()
    .trim()
    .max(160)
    .nullable()
    .optional()
    .default(INBOUND_WEBHOOK_DEFAULTS.EVENT_ID_PAYLOAD_PATH),
  eventTypeHeader: HeaderNameSchema.optional().default(INBOUND_WEBHOOK_DEFAULTS.EVENT_TYPE_HEADER),
  eventTypePayloadPath: z
    .string()
    .trim()
    .max(160)
    .nullable()
    .optional()
    .default(INBOUND_WEBHOOK_DEFAULTS.EVENT_TYPE_PAYLOAD_PATH),
  sensitiveFields: SensitiveFieldsSchema.optional().default([]),
  maxRetries: z.coerce.number().int().min(0).max(9).optional(),
});

export type CreateInboundWebhookProviderRequest = z.infer<
  typeof CreateInboundWebhookProviderRequestSchema
>;
export type CreateInboundWebhookProviderInput = Pick<
  CreateInboundWebhookProviderRequest,
  'providerCode' | 'name'
> &
  Partial<Omit<CreateInboundWebhookProviderRequest, 'providerCode' | 'name'>>;

export const UpdateInboundWebhookProviderRequestSchema = z.object({
  name: z.string().trim().min(2).max(180).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  status: InboundWebhookProviderStatusSchema.optional(),
  authType: AuthTypeSchema.optional(),
  signatureHeader: HeaderNameSchema.optional(),
  signaturePrefix: z.string().max(32).nullable().optional(),
  signatureFormat: SignatureFormatSchema.optional(),
  timestampHeader: HeaderNameSchema.optional(),
  requireTimestamp: z.boolean().optional(),
  toleranceSec: z.coerce.number().int().min(10).max(86_400).optional(),
  eventIdHeader: HeaderNameSchema.optional(),
  eventIdPayloadPath: z.string().trim().max(160).nullable().optional(),
  eventTypeHeader: HeaderNameSchema.optional(),
  eventTypePayloadPath: z.string().trim().max(160).nullable().optional(),
  sensitiveFields: SensitiveFieldsSchema.optional(),
  maxRetries: z.coerce.number().int().min(0).max(9).optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type UpdateInboundWebhookProviderRequest = z.infer<
  typeof UpdateInboundWebhookProviderRequestSchema
>;

export const RotateInboundWebhookSecretRequestSchema = z.object({
  signingSecret: z.string().min(8).max(500).optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type RotateInboundWebhookSecretRequest = z.infer<
  typeof RotateInboundWebhookSecretRequestSchema
>;

export const ListInboundWebhookProvidersQuerySchema = createPaginationQuerySchema().and(
  z.object({
    status: optionalQueryParam(InboundWebhookProviderStatusSchema) as z.ZodType<
      InboundWebhookProviderStatusCode | undefined
    >,
    search: optionalQueryParam(z.string().trim().max(150)),
  }),
);

export type ListInboundWebhookProvidersQuery = z.infer<
  typeof ListInboundWebhookProvidersQuerySchema
>;

export const SimulateInboundWebhookRequestSchema = z.object({
  externalEventId: z.string().trim().min(1).max(160).optional(),
  eventType: z.string().trim().min(1).max(160).optional().default('webhook.simulated'),
  payload: z
    .record(z.string(), z.unknown())
    .optional()
    .default({ message: 'Simulated inbound webhook event' }),
});

export type SimulateInboundWebhookRequest = z.infer<typeof SimulateInboundWebhookRequestSchema>;

export const ListInboundWebhookEventsQuerySchema = createPaginationQuerySchema().and(
  z.object({
    providerCode: optionalQueryParam(z.string().trim().toLowerCase().max(64)),
    eventType: optionalQueryParam(z.string().trim().max(160)),
    status: optionalQueryParam(InboundWebhookEventStatusSchema) as z.ZodType<
      InboundWebhookEventStatusCode | undefined
    >,
    search: optionalQueryParam(z.string().trim().max(150)),
  }),
);

export type ListInboundWebhookEventsQuery = z.infer<typeof ListInboundWebhookEventsQuerySchema>;

export const ReprocessInboundWebhookEventRequestSchema = z.object({
  reason: z.string().trim().max(500).nullable().optional(),
});

export type ReprocessInboundWebhookEventRequest = z.infer<
  typeof ReprocessInboundWebhookEventRequestSchema
>;

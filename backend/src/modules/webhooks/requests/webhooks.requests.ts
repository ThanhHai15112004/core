import { z } from 'zod';
import { createPaginationQuerySchema, optionalQueryParam } from '@packages/http/index.js';
import {
  WEBHOOK_DELIVERY_STATUS,
  WEBHOOK_ENDPOINT_STATUS,
  WEBHOOK_TRIGGER_SOURCE,
  type WebhookDeliveryStatusCode,
  type WebhookEndpointStatusCode,
} from '../enum/webhooks.enum.js';
import { isValidWebhookEventPattern } from '../helpers/webhook-event-matcher.helper.js';

function parseEndpointStatus(val: unknown): unknown {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const clean = val.trim().toUpperCase();
    if (clean === '1' || clean === 'ACTIVE') return WEBHOOK_ENDPOINT_STATUS.ACTIVE;
    if (clean === '2' || clean === 'PAUSED') return WEBHOOK_ENDPOINT_STATUS.PAUSED;
    if (clean === '3' || clean === 'AUTO_DISABLED') return WEBHOOK_ENDPOINT_STATUS.AUTO_DISABLED;
  }
  return val;
}

function parseDeliveryStatus(val: unknown): unknown {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const clean = val.trim().toUpperCase();
    if (clean === '1' || clean === 'PENDING') return WEBHOOK_DELIVERY_STATUS.PENDING;
    if (clean === '2' || clean === 'RETRYING') return WEBHOOK_DELIVERY_STATUS.RETRYING;
    if (clean === '3' || clean === 'DELIVERED') return WEBHOOK_DELIVERY_STATUS.DELIVERED;
    if (clean === '4' || clean === 'FAILED') return WEBHOOK_DELIVERY_STATUS.FAILED;
    if (clean === '5' || clean === 'CANCELLED') return WEBHOOK_DELIVERY_STATUS.CANCELLED;
  }
  return val;
}

export const WebhookEndpointStatusSchema = z.preprocess(
  parseEndpointStatus,
  z.union([
    z.literal(WEBHOOK_ENDPOINT_STATUS.ACTIVE),
    z.literal(WEBHOOK_ENDPOINT_STATUS.PAUSED),
    z.literal(WEBHOOK_ENDPOINT_STATUS.AUTO_DISABLED),
  ]),
);

export const WebhookEndpointManageableStatusSchema = z.preprocess(
  parseEndpointStatus,
  z.union([z.literal(WEBHOOK_ENDPOINT_STATUS.ACTIVE), z.literal(WEBHOOK_ENDPOINT_STATUS.PAUSED)]),
);

export const WebhookDeliveryStatusSchema = z.preprocess(
  parseDeliveryStatus,
  z.union([
    z.literal(WEBHOOK_DELIVERY_STATUS.PENDING),
    z.literal(WEBHOOK_DELIVERY_STATUS.RETRYING),
    z.literal(WEBHOOK_DELIVERY_STATUS.DELIVERED),
    z.literal(WEBHOOK_DELIVERY_STATUS.FAILED),
    z.literal(WEBHOOK_DELIVERY_STATUS.CANCELLED),
  ]),
);

const WebhookEventsListSchema = z
  .array(
    z
      .string()
      .trim()
      .min(1)
      .max(160)
      .refine((v) => isValidWebhookEventPattern(v), {
        message:
          'Invalid webhook event pattern (use e.g. user.created, payment.completed, user.*, or *)',
      }),
  )
  .min(1)
  .max(100);

export const CreateWebhookEndpointRequestSchema = z.object({
  name: z.string().trim().min(2).max(180),
  description: z.string().trim().max(500).nullable().optional(),
  url: z.string().trim().min(8).max(1000),
  events: WebhookEventsListSchema,
  status: WebhookEndpointManageableStatusSchema.optional().default(WEBHOOK_ENDPOINT_STATUS.ACTIVE),
  customHeaders: z.record(z.string().trim().min(1).max(100), z.string().max(1000)).optional(),
  timeoutMs: z.coerce.number().int().min(1000).max(60_000).optional(),
  maxRetries: z.coerce.number().int().min(0).max(9).optional(),
  failureThreshold: z.coerce.number().int().min(2).max(100).optional(),
});

export type CreateWebhookEndpointRequest = z.infer<typeof CreateWebhookEndpointRequestSchema>;

export const UpdateWebhookEndpointRequestSchema = z.object({
  name: z.string().trim().min(2).max(180).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  url: z.string().trim().min(8).max(1000).optional(),
  events: WebhookEventsListSchema.optional(),
  status: WebhookEndpointManageableStatusSchema.optional(),
  customHeaders: z.record(z.string().trim().min(1).max(100), z.string().max(1000)).optional(),
  timeoutMs: z.coerce.number().int().min(1000).max(60_000).optional(),
  maxRetries: z.coerce.number().int().min(0).max(9).optional(),
  failureThreshold: z.coerce.number().int().min(2).max(100).optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type UpdateWebhookEndpointRequest = z.infer<typeof UpdateWebhookEndpointRequestSchema>;

export const ListWebhookEndpointsQuerySchema = createPaginationQuerySchema().and(
  z.object({
    status: optionalQueryParam(WebhookEndpointStatusSchema) as z.ZodType<
      WebhookEndpointStatusCode | undefined
    >,
    search: optionalQueryParam(z.string().trim().max(150)),
  }),
);

export type ListWebhookEndpointsQuery = z.infer<typeof ListWebhookEndpointsQuerySchema>;

export const ReactivateWebhookEndpointRequestSchema = z.object({
  reason: z.string().trim().max(500).nullable().optional(),
});

export type ReactivateWebhookEndpointRequest = z.infer<
  typeof ReactivateWebhookEndpointRequestSchema
>;

export const SendWebhookTestEventRequestSchema = z.object({
  eventName: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .refine((v) => v !== '*' && isValidWebhookEventPattern(v) && !v.endsWith('.*'), {
      message: 'Test eventName must be a concrete event name (e.g. webhook.test or user.created)',
    })
    .optional()
    .default('webhook.test'),
  payload: z
    .record(z.string(), z.unknown())
    .optional()
    .default({ message: 'Test webhook delivery' }),
});

export type SendWebhookTestEventRequest = z.infer<typeof SendWebhookTestEventRequestSchema>;

export const ListWebhookDeliveriesQuerySchema = createPaginationQuerySchema().and(
  z.object({
    endpointId: optionalQueryParam(z.coerce.number().int().min(1)),
    eventName: optionalQueryParam(z.string().trim().max(160)),
    status: optionalQueryParam(WebhookDeliveryStatusSchema) as z.ZodType<
      WebhookDeliveryStatusCode | undefined
    >,
    triggerSource: optionalQueryParam(
      z.enum([
        WEBHOOK_TRIGGER_SOURCE.EVENT,
        WEBHOOK_TRIGGER_SOURCE.MANUAL_REPLAY,
        WEBHOOK_TRIGGER_SOURCE.TEST,
      ]),
    ),
    search: optionalQueryParam(z.string().trim().max(150)),
  }),
);

export type ListWebhookDeliveriesQuery = z.infer<typeof ListWebhookDeliveriesQuerySchema>;

export const ReplayWebhookDeliveryRequestSchema = z.object({
  reason: z.string().trim().max(500).nullable().optional(),
});

export type ReplayWebhookDeliveryRequest = z.infer<typeof ReplayWebhookDeliveryRequestSchema>;

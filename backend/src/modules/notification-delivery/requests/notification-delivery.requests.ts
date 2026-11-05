import { z } from 'zod';
import { booleanQueryParam, optionalQueryParam } from '@packages/http/index.js';
import {
  parseNotificationChannel,
  parseNotificationDeliveryStatus,
  parseNotificationPushPlatform,
  parseNotificationSuppressionReason,
} from '../contracts/index.js';

export const ListNotificationDeliveriesQuerySchema = z.object({
  page: optionalQueryParam(z.coerce.number().int().min(1)).default(1),
  limit: optionalQueryParam(z.coerce.number().int().min(1).max(200)).default(20),
  notificationId: optionalQueryParam(z.coerce.number().int().min(1)),
  recipientUserId: optionalQueryParam(z.coerce.number().int().min(1)),
  channel: optionalQueryParam(
    z.union([z.number(), z.string()]).transform((val) => parseNotificationChannel(val)),
  ),
  status: optionalQueryParam(
    z.union([z.number(), z.string()]).transform((val) => parseNotificationDeliveryStatus(val)),
  ),
  providerCode: optionalQueryParam(z.string().max(64)),
  batchKey: optionalQueryParam(z.string().max(64)),
  search: optionalQueryParam(z.string().max(200)),
});

export type ListNotificationDeliveriesQuery = z.infer<typeof ListNotificationDeliveriesQuerySchema>;

export const UpdateDeliveryStatusWebhookRequestSchema = z.object({
  status: z
    .union([z.number(), z.string()])
    .transform((val) => parseNotificationDeliveryStatus(val)),
  providerMessageId: z.string().trim().max(128).nullable().optional(),
  errorCode: z.string().trim().max(64).nullable().optional(),
  errorMessage: z.string().trim().max(500).nullable().optional(),
  isPermanentFailure: z.boolean().optional(),
  suppressionReason: z
    .union([z.number(), z.string()])
    .optional()
    .transform((val) => (val !== undefined ? parseNotificationSuppressionReason(val) : undefined)),
});

export type UpdateDeliveryStatusWebhookRequest = Omit<
  z.infer<typeof UpdateDeliveryStatusWebhookRequestSchema>,
  'status' | 'suppressionReason'
> & {
  status: number | string;
  suppressionReason?: number | string | undefined;
};

export const ListNotificationSuppressionsQuerySchema = z.object({
  page: optionalQueryParam(z.coerce.number().int().min(1)).default(1),
  limit: optionalQueryParam(z.coerce.number().int().min(1).max(200)).default(20),
  channel: optionalQueryParam(
    z.union([z.number(), z.string()]).transform((val) => parseNotificationChannel(val)),
  ),
  reason: optionalQueryParam(
    z.union([z.number(), z.string()]).transform((val) => parseNotificationSuppressionReason(val)),
  ),
  isActive: optionalQueryParam(booleanQueryParam()),
  search: optionalQueryParam(z.string().max(200)),
});

export type ListNotificationSuppressionsQuery = z.infer<
  typeof ListNotificationSuppressionsQuerySchema
>;

export const CreateNotificationSuppressionRequestSchema = z.object({
  channel: z.union([z.number(), z.string()]).transform((val) => parseNotificationChannel(val)),
  destination: z.string().trim().min(2).max(320),
  reason: z
    .union([z.number(), z.string()])
    .optional()
    .transform((val) => (val !== undefined ? parseNotificationSuppressionReason(val) : undefined)),
  errorMessage: z.string().trim().max(500).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export type CreateNotificationSuppressionRequest = Omit<
  z.infer<typeof CreateNotificationSuppressionRequestSchema>,
  'channel' | 'reason'
> & {
  channel: number | string;
  reason?: number | string | undefined;
};

export const RegisterPushSubscriptionRequestSchema = z.object({
  platform: z
    .union([z.number(), z.string()])
    .optional()
    .transform((val) => (val !== undefined ? parseNotificationPushPlatform(val) : undefined)),
  deviceToken: z.string().trim().min(10).max(320),
  endpoint: z.string().trim().max(500).nullable().optional(),
  p256dhKey: z.string().trim().max(255).nullable().optional(),
  authKey: z.string().trim().max(255).nullable().optional(),
  deviceName: z.string().trim().max(120).nullable().optional(),
});

export type RegisterPushSubscriptionRequest = Omit<
  z.infer<typeof RegisterPushSubscriptionRequestSchema>,
  'platform'
> & {
  platform?: number | string | undefined;
};

import { z } from 'zod';
import { booleanQueryParam, optionalQueryParam } from '@packages/http/index.js';
import {
  parseNotificationCategory,
  parseNotificationChannel,
  parseNotificationDeliveryStatus,
  parseNotificationInboxStatus,
  parseNotificationPriority,
  parseNotificationPushPlatform,
  parseNotificationSuppressionReason,
  parseNotificationTargetType,
} from '../contracts/index.js';

export const ListUserInboxQuerySchema = z.object({
  page: optionalQueryParam(z.coerce.number().int().min(1)).default(1),
  limit: optionalQueryParam(z.coerce.number().int().min(1).max(200)).default(20),
  search: optionalQueryParam(z.string().max(200)),
  inboxStatus: optionalQueryParam(
    z.union([z.number(), z.string()]).transform((val) => parseNotificationInboxStatus(val)),
  ),
  isRead: optionalQueryParam(booleanQueryParam()),
  category: optionalQueryParam(
    z.union([z.number(), z.string()]).transform((val) => parseNotificationCategory(val)),
  ),
  priority: optionalQueryParam(
    z.union([z.number(), z.string()]).transform((val) => parseNotificationPriority(val)),
  ),
});

export type ListUserInboxQuery = z.infer<typeof ListUserInboxQuerySchema>;

export const ListNotificationDispatchesQuerySchema = z.object({
  page: optionalQueryParam(z.coerce.number().int().min(1)).default(1),
  limit: optionalQueryParam(z.coerce.number().int().min(1).max(200)).default(20),
  search: optionalQueryParam(z.string().max(200)),
  category: optionalQueryParam(
    z.union([z.number(), z.string()]).transform((val) => parseNotificationCategory(val)),
  ),
  priority: optionalQueryParam(
    z.union([z.number(), z.string()]).transform((val) => parseNotificationPriority(val)),
  ),
  targetType: optionalQueryParam(
    z.union([z.number(), z.string()]).transform((val) => parseNotificationTargetType(val)),
  ),
  organizationUnitId: optionalQueryParam(z.coerce.number().int().min(1)),
});

export type ListNotificationDispatchesQuery = z.infer<typeof ListNotificationDispatchesQuerySchema>;

export const SendNotificationRequestSchema = z.object({
  title: z.string().trim().max(500).optional(),
  content: z.string().trim().max(50000).optional(),
  templateCode: z.string().trim().max(100).nullable().optional(),
  templateVariables: z.record(z.string(), z.unknown()).nullable().optional(),
  locale: z.string().trim().max(16).optional(),
  idempotencyKey: z.string().trim().max(128).nullable().optional(),
  category: z
    .union([z.number(), z.string()])
    .optional()
    .transform((val) => (val !== undefined ? parseNotificationCategory(val) : undefined)),
  priority: z
    .union([z.number(), z.string()])
    .optional()
    .transform((val) => (val !== undefined ? parseNotificationPriority(val) : undefined)),
  targetType: z
    .union([z.number(), z.string()])
    .transform((val) => parseNotificationTargetType(val)),
  userId: z.coerce.number().int().min(1).optional(),
  userIds: z.array(z.coerce.number().int().min(1)).max(100000).optional(),
  roleIds: z.array(z.coerce.number().int().min(1)).max(500).optional(),
  roleCodes: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
  organizationUnitIds: z.array(z.coerce.number().int().min(1)).max(1000).optional(),
  includeSubUnits: z.boolean().optional(),
  channels: z
    .array(z.union([z.number(), z.string()]).transform((val) => parseNotificationChannel(val)))
    .max(10)
    .optional(),
  actionUrl: z.string().trim().max(500).nullable().optional(),
  referenceModule: z.string().trim().max(64).nullable().optional(),
  referenceType: z.string().trim().max(64).nullable().optional(),
  referenceId: z.string().trim().max(100).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  organizationUnitId: z.coerce.number().int().min(1).nullable().optional(),
  forceDeliver: z.boolean().optional(),
});

export type SendNotificationRequest = z.infer<typeof SendNotificationRequestSchema>;

export const MarkNotificationReadRequestSchema = z.object({
  isRead: z.boolean().default(true),
});

export type MarkNotificationReadRequest = z.infer<typeof MarkNotificationReadRequestSchema>;

export const MarkAllNotificationsReadRequestSchema = z.object({
  category: z
    .union([z.number(), z.string()])
    .optional()
    .transform((val) => (val !== undefined ? parseNotificationCategory(val) : undefined)),
});

export type MarkAllNotificationsReadRequest = z.infer<typeof MarkAllNotificationsReadRequestSchema>;

export const ArchiveNotificationRequestSchema = z.object({
  archived: z.boolean().default(true),
});

export type ArchiveNotificationRequest = z.infer<typeof ArchiveNotificationRequestSchema>;

export const NotificationPreferenceEntryInputSchema = z.object({
  category: z.union([z.number(), z.string()]).transform((val) => parseNotificationCategory(val)),
  inAppEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
  mutedUntil: z.string().datetime().nullable().optional(),
});

export const UpdateNotificationPreferencesRequestSchema = z.object({
  preferences: z.array(NotificationPreferenceEntryInputSchema).min(1).max(20),
});

export type UpdateNotificationPreferencesRequest = z.infer<
  typeof UpdateNotificationPreferencesRequestSchema
>;

export const UpdateNotificationRuntimeConfigRequestSchema = z.object({
  enabled: z.boolean().optional(),
  orgUnitTargetingEnabled: z.boolean().optional(),
  orgUnitIncludeSubUnitsDefault: z.boolean().optional(),
  roleTargetingEnabled: z.boolean().optional(),
  allowUserCustomization: z.boolean().optional(),
  lockSecurityInApp: z.boolean().optional(),
  autoReadOnOpen: z.boolean().optional(),
  retentionDays: z.coerce.number().int().min(0).max(3650).optional(),
  pollingIntervalSec: z.coerce.number().int().min(5).max(600).optional(),
  maxRecipientsPerBatch: z.coerce.number().int().min(1).max(100000).optional(),
  maxTitleLength: z.coerce.number().int().min(20).max(500).optional(),
  maxBodyLength: z.coerce.number().int().min(100).max(50000).optional(),
  enabledChannels: z
    .array(z.enum(['IN_APP', 'EMAIL', 'SMS', 'PUSH']))
    .min(1)
    .optional(),
  defaultChannels: z
    .array(z.enum(['IN_APP', 'EMAIL', 'SMS', 'PUSH']))
    .min(1)
    .optional(),
  orgUnitBroadcastFlagEnabled: z.boolean().optional(),
  roleBroadcastFlagEnabled: z.boolean().optional(),
  inAppFeatureEnabled: z.boolean().optional(),
  userPreferencesFlagEnabled: z.boolean().optional(),
  emailFeatureEnabled: z.boolean().optional(),
  smsFeatureEnabled: z.boolean().optional(),
  pushFeatureEnabled: z.boolean().optional(),
  emailProvider: z.string().trim().min(1).max(64).optional(),
  emailFromAddress: z.string().trim().min(1).max(200).optional(),
  emailFromName: z.string().trim().min(1).max(120).optional(),
  smsProvider: z.string().trim().min(1).max(64).optional(),
  smsSenderId: z.string().trim().min(1).max(64).optional(),
  pushProvider: z.string().trim().min(1).max(64).optional(),
  dispatchBatchSize: z.coerce.number().int().min(1).max(5000).optional(),
  dispatchRateLimitPerSec: z.coerce.number().int().min(1).max(10000).optional(),
  retryEnabled: z.boolean().optional(),
  retryMaxAttempts: z.coerce.number().int().min(1).max(10).optional(),
  retryBaseDelaySec: z.coerce.number().int().min(1).max(3600).optional(),
  autoSuppressOnPermanentFailure: z.boolean().optional(),
  quotaCurrency: z.string().trim().min(1).max(16).optional(),
  quotaHardStopOnExceed: z.boolean().optional(),
  smsDailyQuota: z.coerce.number().int().min(0).max(10000000).optional(),
  smsMonthlyBudget: z.coerce.number().min(0).max(10000000000).optional(),
  smsCostPerSegment: z.coerce.number().min(0).max(1000000).optional(),
  emailDailyQuota: z.coerce.number().int().min(0).max(10000000).optional(),
  emailCostPerMessage: z.coerce.number().min(0).max(100000).optional(),
  pushDailyQuota: z.coerce.number().int().min(0).max(100000000).optional(),
  pushCostPerMessage: z.coerce.number().min(0).max(100000).optional(),
});

export type UpdateNotificationRuntimeConfigRequest = z.infer<
  typeof UpdateNotificationRuntimeConfigRequestSchema
>;

export const ListNotificationTemplatesQuerySchema = z.object({
  page: optionalQueryParam(z.coerce.number().int().min(1)).default(1),
  limit: optionalQueryParam(z.coerce.number().int().min(1).max(200)).default(20),
  search: optionalQueryParam(z.string().max(200)),
  channel: optionalQueryParam(
    z.union([z.number(), z.string()]).transform((val) => parseNotificationChannel(val)),
  ),
  category: optionalQueryParam(
    z.union([z.number(), z.string()]).transform((val) => parseNotificationCategory(val)),
  ),
  locale: optionalQueryParam(z.string().max(16)),
  isActive: optionalQueryParam(booleanQueryParam()),
});

export type ListNotificationTemplatesQuery = z.infer<typeof ListNotificationTemplatesQuerySchema>;

export const UpsertNotificationTemplateRequestSchema = z.object({
  code: z.string().trim().min(2).max(100),
  name: z.string().trim().min(2).max(200),
  channel: z.union([z.number(), z.string()]).transform((val) => parseNotificationChannel(val)),
  category: z
    .union([z.number(), z.string()])
    .optional()
    .transform((val) => (val !== undefined ? parseNotificationCategory(val) : undefined)),
  locale: z.string().trim().min(2).max(16).default('vi'),
  subjectTemplate: z.string().trim().max(500).nullable().optional(),
  bodyTemplate: z.string().trim().min(1).max(50000),
  htmlTemplate: z.string().trim().max(100000).nullable().optional(),
  variables: z.array(z.string().trim().min(1).max(64)).max(100).optional(),
  isActive: z.boolean().optional(),
  organizationUnitId: z.coerce.number().int().min(1).nullable().optional(),
});

export type UpsertNotificationTemplateRequest = z.infer<
  typeof UpsertNotificationTemplateRequestSchema
>;

export const PreviewNotificationTemplateRequestSchema = z.object({
  templateCode: z.string().trim().max(100).optional(),
  channel: z
    .union([z.number(), z.string()])
    .optional()
    .transform((val) => (val !== undefined ? parseNotificationChannel(val) : undefined)),
  locale: z.string().trim().max(16).default('vi'),
  subjectTemplate: z.string().trim().max(500).nullable().optional(),
  bodyTemplate: z.string().trim().max(50000).optional(),
  htmlTemplate: z.string().trim().max(100000).nullable().optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
});

export type PreviewNotificationTemplateRequest = z.infer<
  typeof PreviewNotificationTemplateRequestSchema
>;

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

export type UpdateDeliveryStatusWebhookRequest = z.infer<
  typeof UpdateDeliveryStatusWebhookRequestSchema
>;

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

export type CreateNotificationSuppressionRequest = z.infer<
  typeof CreateNotificationSuppressionRequestSchema
>;

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

export type RegisterPushSubscriptionRequest = z.infer<typeof RegisterPushSubscriptionRequestSchema>;

import { z } from 'zod';
import { booleanQueryParam, optionalQueryParam } from '@packages/http/index.js';
import {
  parseNotificationCategory,
  parseNotificationChannel,
  parseNotificationInboxStatus,
  parseNotificationPriority,
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
  title: z.string().trim().min(1).max(500),
  content: z.string().trim().min(1).max(50000),
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
});

export type UpdateNotificationRuntimeConfigRequest = z.infer<
  typeof UpdateNotificationRuntimeConfigRequestSchema
>;

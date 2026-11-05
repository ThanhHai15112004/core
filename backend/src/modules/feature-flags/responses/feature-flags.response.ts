import { z } from 'zod';

export const featureFlagResponseSchema = z.object({
  id: z.number().int(),
  key: z.string(),
  module: z.string(),
  isModuleInstalled: z.boolean(),
  name: z.string(),
  description: z.string(),
  isEnabled: z.boolean(),
  rolloutPercentage: z.number().int(),
  targetUserIds: z.array(z.string()),
  targetRoles: z.array(z.string()),
  targetOrganizationUnitIds: z.array(z.string()),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  isCurrentlyInWindow: z.boolean(),
  isExpired: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  isSystem: z.boolean(),
  status: z.number().int(),
  statusName: z.enum(['ACTIVE', 'ARCHIVED']),
  updatedBy: z.number().int().nullable(),
  updatedAt: z.string(),
});

export const evaluatedFeatureFlagResponseSchema = z.object({
  key: z.string(),
  module: z.string(),
  enabled: z.boolean(),
  reason: z.string(),
  rolloutPercentage: z.number().int(),
  userBucket: z.number().int().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  evaluatedAt: z.string(),
  fromCache: z.boolean(),
});

export const featureFlagHistoryResponseSchema = z.object({
  id: z.number().int(),
  flagId: z.number().int(),
  flagKey: z.string(),
  action: z.enum(['CREATE', 'UPDATE', 'TOGGLE', 'ARCHIVE']),
  oldState: z.record(z.string(), z.unknown()).nullable(),
  newState: z.record(z.string(), z.unknown()),
  actorUserId: z.number().int().nullable(),
  actorIdentifier: z.string().nullable(),
  reason: z.string().nullable(),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
  correlationId: z.string().nullable(),
  createdAt: z.string(),
});

export const syncFeatureFlagsResultResponseSchema = z.object({
  syncedModules: z.array(z.string()),
  totalFlags: z.number().int(),
});

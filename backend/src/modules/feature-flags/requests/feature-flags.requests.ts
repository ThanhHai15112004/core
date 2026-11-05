import { z } from 'zod';
import { intQueryParam } from '@packages/http/index.js';

const stringOrIntIdArraySchema = z
  .array(z.union([z.string().trim().min(1), z.number().int()]))
  .optional();

export const createFeatureFlagSchema = z.object({
  key: z
    .string()
    .trim()
    .min(3)
    .max(150)
    .regex(
      /^[a-z0-9][a-z0-9._-]*\.[a-z0-9._-]+$/i,
      'Feature flag key must use <module>.<feature> notation',
    ),
  module: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(2).max(255),
  description: z.string().trim().min(3).max(2000),
  isEnabled: z.boolean().optional(),
  rolloutPercentage: z.number().int().min(0).max(100).optional(),
  targetUserIds: stringOrIntIdArraySchema,
  targetRoles: z.array(z.string().trim().min(1)).optional(),
  targetOrganizationUnitIds: stringOrIntIdArraySchema,
  startsAt: z.string().trim().nullable().optional(),
  endsAt: z.string().trim().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  isSystem: z.boolean().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type CreateFeatureFlagRequest = z.infer<typeof createFeatureFlagSchema>;

export const updateFeatureFlagSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  description: z.string().trim().min(3).max(2000).optional(),
  isEnabled: z.boolean().optional(),
  rolloutPercentage: z.number().int().min(0).max(100).optional(),
  targetUserIds: stringOrIntIdArraySchema,
  targetRoles: z.array(z.string().trim().min(1)).optional(),
  targetOrganizationUnitIds: stringOrIntIdArraySchema,
  startsAt: z.string().trim().nullable().optional(),
  endsAt: z.string().trim().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.number().int().min(1).max(2).optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type UpdateFeatureFlagRequest = z.infer<typeof updateFeatureFlagSchema>;

export const toggleFeatureFlagSchema = z.object({
  isEnabled: z.boolean(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type ToggleFeatureFlagRequest = z.infer<typeof toggleFeatureFlagSchema>;

export const listFeatureFlagsQuerySchema = z.object({
  module: z.string().trim().optional(),
  isEnabled: z
    .preprocess((val) => {
      if (typeof val === 'boolean') return val;
      if (val === 'true' || val === '1') return true;
      if (val === 'false' || val === '0') return false;
      return undefined;
    }, z.boolean().optional())
    .optional(),
  status: intQueryParam({ min: 1, max: 2 }).optional(),
  q: z.string().trim().optional(),
});

export type ListFeatureFlagsQuery = z.infer<typeof listFeatureFlagsQuerySchema>;

export const evaluateFeatureFlagsQuerySchema = z.object({
  keys: z
    .preprocess(
      (val) => {
        if (Array.isArray(val)) return val.map(String);
        if (typeof val === 'string') {
          return val
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        }
        return undefined;
      },
      z.array(z.string().min(1)).optional(),
    )
    .optional(),
  key: z.string().trim().optional(),
  module: z.string().trim().optional(),
  userId: z.string().trim().optional(),
  roles: z
    .preprocess(
      (val) => {
        if (Array.isArray(val)) return val.map(String);
        if (typeof val === 'string') {
          return val
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        }
        return undefined;
      },
      z.array(z.string().min(1)).optional(),
    )
    .optional(),
  organizationUnitId: z.string().trim().optional(),
  organizationUnitIds: z
    .preprocess(
      (val) => {
        if (Array.isArray(val)) return val.map(String);
        if (typeof val === 'string') {
          return val
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
        }
        return undefined;
      },
      z.array(z.string().min(1)).optional(),
    )
    .optional(),
  at: z.string().trim().optional(),
});

export type EvaluateFeatureFlagsQuery = z.infer<typeof evaluateFeatureFlagsQuerySchema>;

export const listFeatureFlagHistoryQuerySchema = z.object({
  flagKey: z.string().trim().optional(),
  action: z.string().trim().optional(),
  actorUserId: intQueryParam({ min: 1 }).optional(),
  limit: intQueryParam({ min: 1, max: 200 }).optional(),
});

export type ListFeatureFlagHistoryQuery = z.infer<typeof listFeatureFlagHistoryQuerySchema>;

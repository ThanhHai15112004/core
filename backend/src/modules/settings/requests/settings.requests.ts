import { z } from 'zod';
import { intQueryParam } from '@packages/http/index.js';

export const settingValidationRulesSchema = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
    integerOnly: z.boolean().optional(),
    minLength: z.number().int().min(0).optional(),
    maxLength: z.number().int().min(1).optional(),
    pattern: z.string().optional(),
    enumOptions: z.array(z.union([z.string(), z.number()])).optional(),
    allowEmpty: z.boolean().optional(),
  })
  .optional()
  .nullable();

export const createSettingGroupSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i, 'Group code must be alphanumeric'),
  module: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(1000).nullable().optional(),
  icon: z.string().trim().max(64).nullable().optional(),
  sortOrder: z.number().int().optional(),
});

export type CreateSettingGroupRequest = z.infer<typeof createSettingGroupSchema>;

export const listSettingsQuerySchema = z.object({
  groupCode: z.string().trim().optional(),
  module: z.string().trim().optional(),
  namespace: z.string().trim().optional(),
  valueType: z.union([z.number().int(), z.string().trim()]).optional(),
  isSensitive: z
    .preprocess((val) => {
      if (typeof val === 'boolean') return val;
      if (val === 'true' || val === '1') return true;
      if (val === 'false' || val === '0') return false;
      return undefined;
    }, z.boolean().optional())
    .optional(),
  environment: z.string().trim().optional(),
  organizationUnitId: intQueryParam({ min: 1 }).optional(),
  q: z.string().trim().optional(),
});

export type ListSettingsQuery = z.infer<typeof listSettingsQuerySchema>;

export const resolveSettingsQuerySchema = z.object({
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
  groupCode: z.string().trim().optional(),
  module: z.string().trim().optional(),
  namespace: z.string().trim().optional(),
  environment: z.string().trim().optional(),
  organizationUnitId: intQueryParam({ min: 1 }).optional(),
});

export type ResolveSettingsQuery = z.infer<typeof resolveSettingsQuerySchema>;

export const createSettingSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2)
    .max(150)
    .regex(/^[a-z0-9][a-z0-9._-]*$/i, 'Setting key must use dot/underscore notation'),
  groupCode: z.string().trim().min(1).max(64),
  module: z.string().trim().min(1).max(64).optional(),
  namespace: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(1000).nullable().optional(),
  valueType: z.union([z.number().int(), z.string().trim().min(1)]),
  defaultValue: z.unknown(),
  value: z.unknown().optional(),
  validationRules: settingValidationRulesSchema,
  isSensitive: z.boolean().optional(),
  allowUnitOverride: z.boolean().optional(),
  isSystem: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type CreateSettingRequest = z.infer<typeof createSettingSchema>;

export const updateSettingValueSchema = z.object({
  value: z.unknown(),
  environment: z.string().trim().max(32).optional(),
  organizationUnitId: z.number().int().min(1).nullable().optional(),
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  allowUnitOverride: z.boolean().optional(),
  validationRules: settingValidationRulesSchema,
  reason: z.string().trim().max(500).nullable().optional(),
});

export type UpdateSettingValueRequest = z.infer<typeof updateSettingValueSchema>;

export const bulkUpdateSettingsSchema = z.object({
  environment: z.string().trim().max(32).optional(),
  organizationUnitId: z.number().int().min(1).nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
  items: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(150),
        value: z.unknown(),
        environment: z.string().trim().max(32).optional(),
        organizationUnitId: z.number().int().min(1).nullable().optional(),
        reason: z.string().trim().max(500).nullable().optional(),
      }),
    )
    .min(1)
    .max(100),
});

export type BulkUpdateSettingsRequest = z.infer<typeof bulkUpdateSettingsSchema>;

export const deleteSettingScopeQuerySchema = z.object({
  environment: z.string().trim().optional(),
  organizationUnitId: intQueryParam({ min: 1 }).optional(),
  reason: z.string().trim().max(500).optional(),
});

export type DeleteSettingScopeQuery = z.infer<typeof deleteSettingScopeQuerySchema>;

export const listSettingHistoryQuerySchema = z.object({
  settingKey: z.string().trim().optional(),
  environment: z.string().trim().optional(),
  organizationUnitId: intQueryParam({ min: 1 }).optional(),
  actorUserId: intQueryParam({ min: 1 }).optional(),
  limit: intQueryParam({ min: 1, max: 200 }).optional(),
});

export type ListSettingHistoryQuery = z.infer<typeof listSettingHistoryQuerySchema>;

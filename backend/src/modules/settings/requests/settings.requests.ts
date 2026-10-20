import { z } from 'zod';
import { booleanQueryParam, intQueryParam, optionalQueryParam } from '@packages/http/index.js';

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

export const createSequenceRuleSchema = z.object({
  key: z
    .string()
    .trim()
    .min(3)
    .max(150)
    .regex(
      /^[a-z0-9][a-z0-9._-]*\.[a-z0-9._-]+$/i,
      'Sequence key must use <module>.<sequence_name> notation',
    ),
  module: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(2).max(255),
  description: z.string().trim().max(2000).nullable().optional(),
  prefix: z.string().trim().max(32).optional(),
  suffix: z.string().trim().max(32).optional(),
  separator: z.string().max(4).optional(),
  dateFormat: z.union([z.number().int().min(0).max(6), z.string().trim().min(1)]).optional(),
  templatePattern: z.string().trim().max(255).nullable().optional(),
  paddingLength: z.number().int().min(1).max(12).optional(),
  startValue: z.number().int().min(1).max(999999999).optional(),
  step: z.number().int().min(1).max(10000).optional(),
  resetPolicy: z.union([z.number().int().min(1).max(4), z.string().trim().min(1)]).optional(),
  scopeByUnit: z.boolean().optional(),
  timezone: z.string().trim().min(2).max(64).optional(),
  isSystem: z.boolean().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type CreateSequenceRuleRequest = z.infer<typeof createSequenceRuleSchema>;

export const updateSequenceRuleSchema = z.object({
  name: z.string().trim().min(2).max(255).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  prefix: z.string().trim().max(32).optional(),
  suffix: z.string().trim().max(32).optional(),
  separator: z.string().max(4).optional(),
  dateFormat: z.union([z.number().int().min(0).max(6), z.string().trim().min(1)]).optional(),
  templatePattern: z.string().trim().max(255).nullable().optional(),
  paddingLength: z.number().int().min(1).max(12).optional(),
  startValue: z.number().int().min(1).max(999999999).optional(),
  step: z.number().int().min(1).max(10000).optional(),
  resetPolicy: z.union([z.number().int().min(1).max(4), z.string().trim().min(1)]).optional(),
  scopeByUnit: z.boolean().optional(),
  timezone: z.string().trim().min(2).max(64).optional(),
  status: z.number().int().min(1).max(2).optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type UpdateSequenceRuleRequest = z.infer<typeof updateSequenceRuleSchema>;

export const previewSequenceSchema = z.object({
  key: z.string().trim().optional(),
  prefix: z.string().trim().max(32).optional(),
  suffix: z.string().trim().max(32).optional(),
  separator: z.string().max(4).optional(),
  dateFormat: z.union([z.number().int().min(0).max(6), z.string().trim().min(1)]).optional(),
  templatePattern: z.string().trim().max(255).nullable().optional(),
  paddingLength: z.number().int().min(1).max(12).optional(),
  startValue: z.number().int().min(1).max(999999999).optional(),
  step: z.number().int().min(1).max(10000).optional(),
  resetPolicy: z.union([z.number().int().min(1).max(4), z.string().trim().min(1)]).optional(),
  scopeByUnit: z.boolean().optional(),
  timezone: z.string().trim().min(2).max(64).optional(),
  sampleSequenceNumber: z.number().int().min(1).max(999999999).optional(),
  organizationUnitId: z
    .union([z.number().int().min(1), z.string().trim().min(1)])
    .nullable()
    .optional(),
  unitCode: z.string().trim().max(32).nullable().optional(),
  at: z.string().trim().nullable().optional(),
});

export type PreviewSequenceRequest = z.infer<typeof previewSequenceSchema>;

export const generateSequenceNextSchema = z.object({
  count: z.number().int().min(1).max(100).optional(),
  organizationUnitId: z
    .union([z.number().int().min(1), z.string().trim().min(1)])
    .nullable()
    .optional(),
  unitCode: z.string().trim().max(32).nullable().optional(),
  at: z.string().trim().nullable().optional(),
  timezone: z.string().trim().min(2).max(64).nullable().optional(),
});

export type GenerateSequenceNextRequest = z.infer<typeof generateSequenceNextSchema>;

export const listSequenceRulesQuerySchema = z.object({
  module: z.string().trim().optional(),
  resetPolicy: intQueryParam({ min: 1, max: 4 }).optional(),
  scopeByUnit: booleanQueryParam().optional(),
  status: intQueryParam({ min: 1, max: 2 }).optional(),
  q: z.string().trim().optional(),
});

export type ListSequenceRulesQuery = z.infer<typeof listSequenceRulesQuerySchema>;

export const listSequenceHistoryQuerySchema = z.object({
  sequenceKey: z.string().trim().optional(),
  action: z.string().trim().optional(),
  actorUserId: intQueryParam({ min: 1 }).optional(),
  limit: intQueryParam({ min: 1, max: 200 }).optional(),
});

export type ListSequenceHistoryQuery = z.infer<typeof listSequenceHistoryQuerySchema>;

export const createMenuSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(100)
    .regex(
      /^[a-z0-9][a-z0-9._-]*$/i,
      'Menu code must be alphanumeric (dots, underscores, hyphens allowed)',
    ),
  module: z.string().trim().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(255),
  status: z
    .union([z.number().int().min(0).max(1), z.string().trim().min(1), z.boolean()])
    .optional(),
  link: z.string().trim().max(255).nullable().optional(),
  linkApi: z.string().trim().max(255).nullable().optional(),
  type: z.union([z.number().int().min(1).max(4), z.string().trim().min(1)]).optional(),
  parent: z.number().int().min(0).nullable().optional(),
  parentCode: z.string().trim().max(100).nullable().optional(),
  key: z.string().trim().max(150).nullable().optional(),
  numOrder: z.number().int().min(-10000).max(100000).optional(),
  icon: z.string().trim().max(64).nullable().optional(),
  position: z.string().trim().min(2).max(32).optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type CreateMenuRequest = z.infer<typeof createMenuSchema>;

export const updateMenuSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  status: z
    .union([z.number().int().min(0).max(1), z.string().trim().min(1), z.boolean()])
    .optional(),
  link: z.string().trim().max(255).nullable().optional(),
  linkApi: z.string().trim().max(255).nullable().optional(),
  type: z.union([z.number().int().min(1).max(4), z.string().trim().min(1)]).optional(),
  parent: z.number().int().min(0).nullable().optional(),
  parentCode: z.string().trim().max(100).nullable().optional(),
  key: z.string().trim().max(150).nullable().optional(),
  numOrder: z.number().int().min(-10000).max(100000).optional(),
  icon: z.string().trim().max(64).nullable().optional(),
  position: z.string().trim().min(2).max(32).optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type UpdateMenuRequest = z.infer<typeof updateMenuSchema>;

export const toggleMenuSchema = z.object({
  status: z
    .union([z.number().int().min(0).max(1), z.string().trim().min(1), z.boolean()])
    .optional(),
  cascadeChildren: z.boolean().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type ToggleMenuRequest = z.infer<typeof toggleMenuSchema>;

export const reorderMenusSchema = z.object({
  items: z
    .array(
      z.object({
        code: z.string().trim().min(2).max(100),
        numOrder: z.number().int().min(-10000).max(100000),
        parent: z.number().int().min(0).nullable().optional(),
        parentCode: z.string().trim().max(100).nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type ReorderMenusRequest = z.infer<typeof reorderMenusSchema>;

export const listMenusQuerySchema = z.object({
  module: optionalQueryParam(z.string().trim()),
  status: optionalQueryParam(intQueryParam({ min: 0, max: 1 })),
  type: optionalQueryParam(intQueryParam({ min: 1, max: 4 })),
  parent: optionalQueryParam(intQueryParam({ min: 0 })),
  level: optionalQueryParam(intQueryParam({ min: 1, max: 20 })),
  position: optionalQueryParam(z.string().trim()),
  q: optionalQueryParam(z.string().trim()),
});

export type ListMenusQuery = z.infer<typeof listMenusQuerySchema>;

export const getMenuTreeQuerySchema = z.object({
  position: optionalQueryParam(z.string().trim()),
  type: optionalQueryParam(intQueryParam({ min: 1, max: 4 })),
  includeInactive: optionalQueryParam(booleanQueryParam()),
});

export type GetMenuTreeQuery = z.infer<typeof getMenuTreeQuerySchema>;

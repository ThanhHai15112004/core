import { z } from 'zod';

export const ModuleTypeSchema = z.enum(['core', 'project']);

export const ModuleEventsManifestSchema = z
  .object({
    published: z.array(z.string()).optional(),
    subscribed: z.array(z.string()).optional(),
  })
  .optional();

export const ModuleDatabaseManifestSchema = z
  .object({
    hasMigrations: z.boolean().optional(),
    tables: z.array(z.string()).optional(),
  })
  .optional();

export const ModuleCodeValueManifestSchema = z.object({
  numericCode: z.number().int(),
  code: z.string().min(1),
  name: z.string().min(1),
  labels: z.record(z.string(), z.string()).optional(),
  aliases: z.array(z.string()).optional(),
  behaviorCode: z.string().nullable().optional(),
  badgeTone: z.enum(['success', 'warning', 'danger', 'info', 'neutral']).optional(),
  sortOrder: z.number().int().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  isSystem: z.boolean().optional(),
  status: z.number().int().optional(),
});

export const ModuleCodeTypeManifestSchema = z.object({
  code: z.string().min(1),
  module: z.string().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  isSystem: z.boolean().optional(),
  allowCustomValues: z.boolean().optional(),
  status: z.number().int().optional(),
  values: z.array(ModuleCodeValueManifestSchema).optional().default([]),
});

export const ModuleSettingGroupManifestSchema = z.object({
  code: z.string().min(1),
  module: z.string().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  icon: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
  isSystem: z.boolean().optional(),
  status: z.number().int().optional(),
});

export const ModuleSettingManifestSchema = z.object({
  key: z.string().min(1),
  groupCode: z.string().min(1),
  module: z.string().optional(),
  namespace: z.string().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  valueType: z.union([z.number().int(), z.string().min(1)]),
  defaultValue: z.unknown(),
  validationRules: z.record(z.string(), z.unknown()).nullable().optional(),
  isSensitive: z.boolean().optional(),
  allowUnitOverride: z.boolean().optional(),
  isSystem: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  status: z.number().int().optional(),
  environmentOverrides: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const ModuleFeatureFlagManifestSchema = z.object({
  key: z.string().min(1),
  module: z.string().optional(),
  name: z.string().min(1),
  description: z.string().min(1),
  isEnabled: z.boolean().optional(),
  rolloutPercentage: z.number().int().min(0).max(100).optional(),
  targetUserIds: z.array(z.string()).optional(),
  targetRoles: z.array(z.string()).optional(),
  targetOrganizationUnitIds: z.array(z.string()).optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  isSystem: z.boolean().optional(),
  status: z.number().int().optional(),
});

export const ModuleLocaleManifestSchema = z.object({
  code: z.string().min(2).max(16),
  bcp47Tag: z.string().min(2).max(32).optional(),
  name: z.string().min(1),
  nativeName: z.string().min(1),
  direction: z.enum(['ltr', 'rtl']).optional(),
  dateFormat: z.string().min(1),
  datetimeFormat: z.string().min(1),
  currencyCode: z.string().min(3).max(8),
  numberDecimalSeparator: z.string().min(1).max(4).optional(),
  numberGroupSeparator: z.string().min(1).max(4).optional(),
  isDefault: z.boolean().optional(),
  isSystem: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  status: z.number().int().optional(),
});

export const ModuleTimezoneManifestSchema = z.object({
  code: z.string().min(2).max(64),
  name: z.string().min(1),
  labels: z.record(z.string(), z.string()).optional(),
  utcOffset: z.string().min(3).max(16),
  utcOffsetMinutes: z.number().int(),
  region: z.string().optional(),
  isDefault: z.boolean().optional(),
  isSystem: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  status: z.number().int().optional(),
});

export const ModuleTranslationManifestSchema = z.object({
  locale: z.string().min(2).max(16),
  namespace: z.string().min(1),
  key: z.string().min(1),
  value: z.string(),
  description: z.string().nullable().optional(),
  isSystem: z.boolean().optional(),
  status: z.number().int().optional(),
});

export const ModuleSequenceManifestSchema = z.object({
  key: z.string().min(1),
  module: z.string().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
  separator: z.string().optional(),
  dateFormat: z.union([z.number().int(), z.string().min(1)]).optional(),
  templatePattern: z.string().nullable().optional(),
  paddingLength: z.number().int().min(1).max(12).optional(),
  startValue: z.number().int().min(1).optional(),
  step: z.number().int().min(1).optional(),
  resetPolicy: z.union([z.number().int(), z.string().min(1)]).optional(),
  scopeByUnit: z.boolean().optional(),
  timezone: z.string().optional(),
  isSystem: z.boolean().optional(),
  status: z.number().int().optional(),
});

export const ModuleMenuManifestSchema = z.object({
  code: z.string().min(2).max(100),
  name: z.string().min(1).max(255),
  module: z.string().optional(),
  status: z.union([z.number().int(), z.string(), z.boolean()]).optional(),
  link: z.string().nullable().optional(),
  linkApi: z.string().nullable().optional(),
  type: z.union([z.number().int(), z.string()]).optional(),
  parent: z.number().int().nullable().optional(),
  parentCode: z.string().nullable().optional(),
  level: z.number().int().min(1).optional(),
  key: z.string().nullable().optional(),
  numOrder: z.number().int().optional(),
  icon: z.string().nullable().optional(),
  position: z.string().optional(),
});

export const ModuleReportParameterSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  type: z.enum([
    'date-range',
    'status',
    'organization-unit',
    'filter',
    'string',
    'number',
    'boolean',
  ]),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  allowedValues: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const ModuleReportManifestSchema = z.object({
  code: z.string().min(1),
  module: z.string().optional(),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  category: z.enum(['REPORT', 'DASHBOARD']).optional(),
  requiredPermission: z.string().min(3),
  isHeavy: z.boolean().optional(),
  heavyRecordThreshold: z.number().int().min(1).optional(),
  cacheTtlSeconds: z.number().int().min(0).optional(),
  supportsReadReplica: z.boolean().optional(),
  supportedFormats: z.array(z.enum(['xlsx', 'csv', 'pdf'])).optional(),
  parameters: z.array(ModuleReportParameterSchema).optional().default([]),
  isSystem: z.boolean().optional(),
  status: z.number().int().optional(),
});

export const ModuleSearchableEntityManifestSchema = z.object({
  code: z.string().min(1),
  module: z.string().optional(),
  entityType: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  requiredPermission: z.string().min(3),
  searchableFields: z.array(z.string().min(1)).optional().default(['title', 'subtitle']),
  titleField: z.string().min(1).optional(),
  subtitleField: z.string().nullable().optional(),
  staleThresholdMs: z.number().int().min(0).optional(),
  isSystem: z.boolean().optional(),
  status: z.number().int().optional(),
});

export const ModuleManifestSchema = z.object({
  $schema: z.string().optional(),
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'Module name must be lowercase kebab-case'),
  displayName: z.string().min(1),
  version: z.string().min(1),
  description: z.string().optional(),
  type: ModuleTypeSchema,
  category: z.string().optional(),
  author: z.string().optional(),
  entryModule: z.string().min(1),
  dependencies: z.array(z.string()).optional().default([]),
  permissions: z.array(z.string()).optional().default([]),
  codeTypes: z.array(ModuleCodeTypeManifestSchema).optional().default([]),
  settingGroups: z.array(ModuleSettingGroupManifestSchema).optional().default([]),
  settings: z.array(ModuleSettingManifestSchema).optional().default([]),
  featureFlags: z.array(ModuleFeatureFlagManifestSchema).optional().default([]),
  sequences: z.array(ModuleSequenceManifestSchema).optional().default([]),
  menus: z.array(ModuleMenuManifestSchema).optional().default([]),
  reports: z.array(ModuleReportManifestSchema).optional().default([]),
  searchableEntities: z.array(ModuleSearchableEntityManifestSchema).optional().default([]),
  locales: z.array(ModuleLocaleManifestSchema).optional().default([]),
  timezones: z.array(ModuleTimezoneManifestSchema).optional().default([]),
  translations: z.array(ModuleTranslationManifestSchema).optional().default([]),
  events: ModuleEventsManifestSchema,
  database: ModuleDatabaseManifestSchema,
});

export const ProjectManifestSettingsSchema = z
  .object({
    defaultLocale: z.string().optional(),
    supportedLocales: z.array(z.string()).optional(),
  })
  .optional();

export const ProjectManifestSchema = z.object({
  $schema: z.string().optional(),
  name: z.string().min(1),
  version: z.string().min(1),
  coreVersion: z.string().min(1),
  description: z.string().optional(),
  environment: z.string().optional(),
  enabledModules: z.array(z.string()).default([]),
  settings: ProjectManifestSettingsSchema,
});

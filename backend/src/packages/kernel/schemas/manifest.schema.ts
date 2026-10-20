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

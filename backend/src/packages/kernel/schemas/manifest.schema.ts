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

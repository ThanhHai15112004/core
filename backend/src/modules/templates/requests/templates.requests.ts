import { z } from 'zod';
import { booleanQueryParam, optionalQueryParam } from '@packages/http/index.js';
import { parseNotificationCategory, parseNotificationChannel } from '../contracts/index.js';

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
  templateType: optionalQueryParam(z.string().max(32)),
  isActive: optionalQueryParam(booleanQueryParam()),
});

export type ListNotificationTemplatesQuery = z.infer<typeof ListNotificationTemplatesQuerySchema>;
export const listTemplatesQuerySchema = ListNotificationTemplatesQuerySchema;
export type ListTemplatesQuery = ListNotificationTemplatesQuery;

export const UpsertNotificationTemplateRequestSchema = z.object({
  code: z.string().trim().min(2).max(100),
  name: z.string().trim().min(2).max(200),
  channel: z
    .union([z.number(), z.string()])
    .optional()
    .transform((val) => (val !== undefined ? parseNotificationChannel(val) : undefined)),
  category: z
    .union([z.number(), z.string()])
    .optional()
    .transform((val) => (val !== undefined ? parseNotificationCategory(val) : undefined)),
  locale: z.string().trim().min(2).max(16).default('vi'),
  templateType: z.enum(['NOTIFICATION', 'EMAIL', 'DOCUMENT']).optional(),
  documentFormat: z.enum(['HTML', 'PDF', 'MARKDOWN', 'TXT']).nullable().optional(),
  subjectTemplate: z.string().trim().max(500).nullable().optional(),
  bodyTemplate: z.string().trim().min(1).max(50000),
  htmlTemplate: z.string().trim().max(100000).nullable().optional(),
  variables: z.array(z.string().trim().min(1).max(64)).max(100).optional(),
  changeNote: z.string().trim().max(500).nullable().optional(),
  saveAsDraft: z.boolean().optional(),
  autoPublish: z.boolean().optional(),
  isActive: z.boolean().optional(),
  organizationUnitId: z.coerce.number().int().min(1).nullable().optional(),
});

export type UpsertNotificationTemplateRequest = Omit<
  z.infer<typeof UpsertNotificationTemplateRequestSchema>,
  'channel' | 'category' | 'locale'
> & {
  channel?: number | string | undefined;
  category?: number | string | undefined;
  locale?: string | undefined;
};
export const upsertTemplateSchema = UpsertNotificationTemplateRequestSchema;
export type UpsertTemplateRequest = UpsertNotificationTemplateRequest;

export const CreateNotificationTemplateVersionRequestSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  subjectTemplate: z.string().trim().max(500).nullable().optional(),
  bodyTemplate: z.string().trim().min(1).max(50000),
  htmlTemplate: z.string().trim().max(100000).nullable().optional(),
  documentFormat: z.enum(['HTML', 'PDF', 'MARKDOWN', 'TXT']).nullable().optional(),
  variables: z.array(z.string().trim().min(1).max(64)).max(100).optional(),
  changeNote: z.string().trim().max(500).nullable().optional(),
  autoPublish: z.boolean().optional(),
});

export type CreateNotificationTemplateVersionRequest = z.infer<
  typeof CreateNotificationTemplateVersionRequestSchema
>;
export const createTemplateVersionSchema = CreateNotificationTemplateVersionRequestSchema;
export type CreateTemplateVersionRequest = CreateNotificationTemplateVersionRequest;

export const PublishNotificationTemplateVersionRequestSchema = z.object({
  version: z.coerce.number().int().min(1),
  changeNote: z.string().trim().max(500).nullable().optional(),
});

export type PublishNotificationTemplateVersionRequest = z.infer<
  typeof PublishNotificationTemplateVersionRequestSchema
>;
export const publishTemplateVersionSchema = PublishNotificationTemplateVersionRequestSchema;
export type PublishTemplateVersionRequest = PublishNotificationTemplateVersionRequest;

export const RollbackNotificationTemplateVersionRequestSchema = z.object({
  targetVersion: z.coerce.number().int().min(1),
  reason: z.string().trim().max(500).nullable().optional(),
});

export type RollbackNotificationTemplateVersionRequest = z.infer<
  typeof RollbackNotificationTemplateVersionRequestSchema
>;
export const rollbackTemplateVersionSchema = RollbackNotificationTemplateVersionRequestSchema;
export type RollbackTemplateVersionRequest = RollbackNotificationTemplateVersionRequest;

export const PreviewNotificationTemplateRequestSchema = z.object({
  templateId: z.coerce.number().int().min(1).optional(),
  templateCode: z.string().trim().max(100).optional(),
  channel: z
    .union([z.number(), z.string()])
    .optional()
    .transform((val) => (val !== undefined ? parseNotificationChannel(val) : undefined)),
  locale: z.string().trim().max(16).default('vi'),
  version: z.coerce.number().int().min(1).optional(),
  subjectTemplate: z.string().trim().max(500).nullable().optional(),
  bodyTemplate: z.string().trim().max(50000).optional(),
  htmlTemplate: z.string().trim().max(100000).nullable().optional(),
  declaredVariables: z.array(z.string().trim().min(1).max(64)).max(100).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
});

export type PreviewNotificationTemplateRequest = Omit<
  z.infer<typeof PreviewNotificationTemplateRequestSchema>,
  'channel' | 'locale'
> & {
  channel?: number | string | undefined;
  locale?: string | undefined;
};
export const previewTemplateSchema = PreviewNotificationTemplateRequestSchema;
export type PreviewTemplateRequest = PreviewNotificationTemplateRequest;

export const RenderDocumentFromTemplateRequestSchema = z.object({
  templateId: z.coerce.number().int().min(1).optional(),
  templateCode: z.string().trim().max(100).optional(),
  locale: z.string().trim().max(16).default('vi'),
  version: z.coerce.number().int().min(1).optional(),
  outputFormat: z.enum(['HTML', 'PDF', 'MARKDOWN', 'TXT']).optional(),
  fileName: z.string().trim().max(200).nullable().optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  referenceModule: z.string().trim().max(64).nullable().optional(),
  referenceFeature: z.string().trim().max(100).nullable().optional(),
});

export type RenderDocumentFromTemplateRequest = Omit<
  z.infer<typeof RenderDocumentFromTemplateRequestSchema>,
  'locale'
> & {
  locale?: string | undefined;
};
export const renderDocumentFromTemplateSchema = RenderDocumentFromTemplateRequestSchema;

export const RegisterNotificationTemplateUsageRequestSchema = z.object({
  moduleName: z.string().trim().min(2).max(64),
  featureCode: z.string().trim().min(2).max(100),
  entityType: z.string().trim().max(64).nullable().optional(),
  entityId: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().max(255).nullable().optional(),
});

export type RegisterNotificationTemplateUsageRequest = z.infer<
  typeof RegisterNotificationTemplateUsageRequestSchema
>;
export const registerTemplateUsageSchema = RegisterNotificationTemplateUsageRequestSchema;
export type RegisterTemplateUsageRequest = RegisterNotificationTemplateUsageRequest;

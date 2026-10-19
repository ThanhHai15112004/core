import { z } from 'zod';

export const resolvedCodeValueResponseSchema = z.object({
  typeCode: z.string(),
  numericCode: z.number().int(),
  code: z.string(),
  behaviorCode: z.string().nullable(),
  name: z.string(),
  displayLabel: z.string(),
  description: z.string().nullable(),
  labels: z.record(z.string(), z.string()),
  aliases: z.array(z.string()),
  color: z.string().nullable(),
  icon: z.string().nullable(),
  sortOrder: z.number().int(),
  isDefault: z.boolean(),
  isSystem: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  status: z.number().int(),
  statusName: z.enum(['ACTIVE', 'INACTIVE']),
});

export type ResolvedCodeValueResponse = z.infer<typeof resolvedCodeValueResponseSchema>;

export const codeTypeSummaryResponseSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  module: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  isSystem: z.boolean(),
  allowCustomValues: z.boolean(),
  status: z.number().int(),
  totalValues: z.number().int(),
  values: z.array(resolvedCodeValueResponseSchema).optional(),
});

export type CodeTypeSummaryResponse = z.infer<typeof codeTypeSummaryResponseSchema>;

export const bootstrapCodesResponseSchema = z.object({
  locale: z.string(),
  totalTypes: z.number().int(),
  dictionary: z.record(z.string(), z.array(resolvedCodeValueResponseSchema)),
});

export type BootstrapCodesResponse = z.infer<typeof bootstrapCodesResponseSchema>;

export const syncCodesResultResponseSchema = z.object({
  syncedModules: z.array(z.string()),
  totalCodeTypes: z.number().int(),
  createdTypesCount: z.number().int(),
  updatedTypesCount: z.number().int(),
  totalCodeValues: z.number().int(),
  createdValuesCount: z.number().int(),
  updatedValuesCount: z.number().int(),
});

export type SyncCodesResultResponse = z.infer<typeof syncCodesResultResponseSchema>;

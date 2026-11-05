import { z } from 'zod';
import { booleanQueryParam, intQueryParam } from '@packages/http/index.js';

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

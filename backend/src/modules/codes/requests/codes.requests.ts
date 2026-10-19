import { z } from 'zod';
import { CODE_ITEM_STATUS } from '@packages/kernel/index.js';

const codeItemStatusSchema = z.preprocess(
  (val) => {
    if (val === undefined || val === null || val === '') return undefined;
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const num = Number(val);
      if (!Number.isNaN(num)) return num;
      return val.trim().toUpperCase() === 'INACTIVE'
        ? CODE_ITEM_STATUS.INACTIVE
        : CODE_ITEM_STATUS.ACTIVE;
    }
    return val;
  },
  z.union([z.literal(1), z.literal(2)]),
);

export const bootstrapCodesQuerySchema = z.object({
  locale: z.string().trim().min(2).max(16).optional(),
  module: z.string().trim().min(1).max(64).optional(),
  includeInactive: z
    .preprocess((v) => v === 'true' || v === true || v === '1', z.boolean())
    .optional(),
});

export type BootstrapCodesQuery = z.infer<typeof bootstrapCodesQuerySchema>;

export const listCodeTypesQuerySchema = z.object({
  module: z.string().trim().min(1).max(64).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  locale: z.string().trim().min(2).max(16).optional(),
  includeValues: z
    .preprocess((v) => v === 'true' || v === true || v === '1', z.boolean())
    .optional(),
});

export type ListCodeTypesQuery = z.infer<typeof listCodeTypesQuerySchema>;

export const listCodeValuesQuerySchema = z.object({
  locale: z.string().trim().min(2).max(16).optional(),
  includeInactive: z
    .preprocess((v) => v === 'true' || v === true || v === '1', z.boolean())
    .optional(),
});

export type ListCodeValuesQuery = z.infer<typeof listCodeValuesQuerySchema>;

export const typeCodeParamSchema = z
  .string()
  .trim()
  .min(3)
  .max(100)
  .regex(/^[a-z0-9_-]+\.[a-z0-9_.-]+$/i, 'Invalid typeCode format (<module>.<type_code>)');

export const createCodeValueSchema = z.object({
  numericCode: z.coerce.number().int().min(1).max(999999).optional(),
  code: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  behaviorCode: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .nullish(),
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(1000).nullish(),
  labels: z.record(z.string(), z.string()).optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).optional(),
  color: z.string().trim().max(32).nullish(),
  icon: z.string().trim().max(64).nullish(),
  sortOrder: z.coerce.number().int().min(0).max(999999).optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  status: codeItemStatusSchema.optional().default(CODE_ITEM_STATUS.ACTIVE),
});

export type CreateCodeValueRequest = z.infer<typeof createCodeValueSchema>;

export const updateCodeValueSchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(1000).nullish(),
  behaviorCode: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/)
    .nullish(),
  labels: z.record(z.string(), z.string()).optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).optional(),
  color: z.string().trim().max(32).nullish(),
  icon: z.string().trim().max(64).nullish(),
  sortOrder: z.coerce.number().int().min(0).max(999999).optional(),
  isDefault: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).nullish(),
  status: codeItemStatusSchema.optional(),
});

export type UpdateCodeValueRequest = z.infer<typeof updateCodeValueSchema>;

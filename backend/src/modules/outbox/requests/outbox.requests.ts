import { z } from 'zod';
import { createPaginationQuerySchema, optionalQueryParam } from '@packages/http/index.js';
import { parseOutboxEventStatus } from '../enum/outbox.enum.js';

const optionalStatusSchema = optionalQueryParam(
  z
    .union([z.number(), z.string()])
    .transform((val, ctx) => {
      const parsed = parseOutboxEventStatus(val);
      if (parsed === null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Invalid outbox event status (expected 1..5 or PENDING/PROCESSING/PUBLISHED/FAILED/DEAD_LETTER)',
        });
        return z.NEVER;
      }
      return parsed;
    }),
);

export const ListOutboxEventsQuerySchema = createPaginationQuerySchema({ defaultLimit: 20 }).and(
  z.object({
    status: optionalStatusSchema,
    sourceModule: optionalQueryParam(z.string().trim().min(1).max(80)),
    eventType: optionalQueryParam(z.string().trim().min(1).max(160)),
    aggregateType: optionalQueryParam(z.string().trim().min(1).max(120)),
    aggregateId: optionalQueryParam(z.string().trim().min(1).max(160)),
    correlationId: optionalQueryParam(z.string().trim().min(1).max(120)),
    search: optionalQueryParam(z.string().trim().min(1).max(200)),
  }),
);

export type ListOutboxEventsQuery = z.infer<typeof ListOutboxEventsQuerySchema>;

export const ReplayOutboxEventRequestSchema = z.object({
  reason: z.string().trim().min(3, 'Vui lòng nhập lý do phát lại (tối thiểu 3 ký tự)').max(500),
  force: z.boolean().optional().default(false),
});

export type ReplayOutboxEventRequest = z.infer<typeof ReplayOutboxEventRequestSchema>;

export const ReplayOutboxBatchRequestSchema = z.object({
  ids: z
    .array(z.coerce.number().int().positive())
    .min(1, 'Cần chọn ít nhất 1 sự kiện để phát lại')
    .max(100, 'Chỉ cho phép phát lại tối đa 100 sự kiện mỗi lượt'),
  reason: z.string().trim().min(3, 'Vui lòng nhập lý do phát lại (tối thiểu 3 ký tự)').max(500),
  force: z.boolean().optional().default(false),
});

export type ReplayOutboxBatchRequest = z.infer<typeof ReplayOutboxBatchRequestSchema>;

export const PurgeOutboxRequestSchema = z.object({
  publishedRetentionDays: z.coerce.number().int().min(1).max(365).optional(),
  deadLetterRetentionDays: z.coerce.number().int().min(1).max(365).optional(),
  batchSize: z.coerce.number().int().min(50).max(10_000).optional(),
  reason: z.string().trim().min(3).max(500).optional(),
});

export type PurgeOutboxRequest = z.infer<typeof PurgeOutboxRequestSchema>;

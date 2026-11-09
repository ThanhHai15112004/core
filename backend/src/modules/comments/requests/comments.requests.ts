import { z } from 'zod';
import { booleanQueryParam, intQueryParam, optionalQueryParam } from '@packages/http/index.js';

export const createRecordCommentSchema = z.object({
  entityType: z.string().trim().min(2).max(64),
  entityId: z.string().trim().min(1).max(128),
  workflowInstanceId: z.number().int().min(1).nullable().optional().default(null),
  parentCommentId: z.number().int().min(1).nullable().optional().default(null),
  content: z.string().trim().min(1).max(10000),
  isInternal: z.boolean().optional().default(false),
  mentionedUserIds: z.array(z.number().int().min(1)).max(50).optional().default([]),
  attachmentFileIds: z.array(z.number().int().min(1)).max(30).optional().default([]),
});

export type CreateRecordCommentRequest = z.infer<typeof createRecordCommentSchema>;

export const updateRecordCommentSchema = z.object({
  content: z.string().trim().min(1).max(10000),
  mentionedUserIds: z.array(z.number().int().min(1)).max(50).optional(),
  attachmentFileIds: z.array(z.number().int().min(1)).max(30).optional(),
  editReason: z.string().trim().max(500).nullable().optional().default(null),
});

export type UpdateRecordCommentRequest = z.infer<typeof updateRecordCommentSchema>;

export const listRecordCommentsQuerySchema = z.object({
  entityType: optionalQueryParam(z.string().trim().max(64)),
  entityId: optionalQueryParam(z.string().trim().max(128)),
  workflowInstanceId: optionalQueryParam(intQueryParam({ min: 1 })),
  includeInternal: optionalQueryParam(booleanQueryParam()),
  includeDeleted: optionalQueryParam(booleanQueryParam()),
});

export type ListRecordCommentsQuery = z.infer<typeof listRecordCommentsQuerySchema>;

export const getRecordActivityTimelineQuerySchema = z.object({
  entityType: z.string().trim().min(2).max(64),
  entityId: z.string().trim().min(1).max(128),
  workflowInstanceId: optionalQueryParam(intQueryParam({ min: 1 })),
  includeInternal: optionalQueryParam(booleanQueryParam()),
  source: optionalQueryParam(z.enum(['ALL', 'COMMENT', 'WORKFLOW', 'AUDIT'])),
  sortOrder: optionalQueryParam(z.enum(['ASC', 'DESC'])),
  limit: optionalQueryParam(intQueryParam({ min: 1, max: 500 })),
});

export type GetRecordActivityTimelineQuery = z.infer<typeof getRecordActivityTimelineQuerySchema>;

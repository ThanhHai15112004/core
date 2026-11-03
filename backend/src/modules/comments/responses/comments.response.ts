import { z } from 'zod';
import type { RecordCommentItemView } from '../contracts/index.js';

export const recordCommentEditHistoryItemSchema = z.object({
  previousContent: z.string(),
  previousAttachmentFileIds: z.array(z.number().int()),
  editedByUserId: z.number().int().nullable(),
  editedByFullName: z.string().nullable(),
  editedAt: z.string(),
  editReason: z.string().nullable(),
});

export const recordCommentAttachmentItemSchema = z.object({
  fileId: z.number().int().positive(),
  code: z.string(),
  displayName: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  sizeFormatted: z.string(),
});

export const recordCommentMentionItemSchema = z.object({
  userId: z.number().int().positive(),
  username: z.string().nullable(),
  fullName: z.string().nullable(),
});

export const recordCommentItemResponseSchema: z.ZodType<RecordCommentItemView> = z.lazy(() =>
  z.object({
    id: z.number().int().positive(),
    entityType: z.string(),
    entityId: z.string(),
    workflowInstanceId: z.number().int().nullable(),
    parentCommentId: z.number().int().nullable(),
    content: z.string(),
    isInternal: z.boolean(),
    authorUserId: z.number().int().nullable(),
    authorFullName: z.string().nullable(),
    authorUsername: z.string().nullable(),
    mentions: z.array(recordCommentMentionItemSchema),
    attachmentFileIds: z.array(z.number().int()),
    attachments: z.array(recordCommentAttachmentItemSchema),
    editHistories: z.array(recordCommentEditHistoryItemSchema),
    replies: z.array(recordCommentItemResponseSchema),
    isEdited: z.boolean(),
    isDeleted: z.boolean(),
    deletedAt: z.string().nullable(),
    deletedByUserId: z.number().int().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

export const recordActivityTimelineEntryResponseSchema = z.object({
  id: z.string(),
  source: z.enum(['COMMENT', 'WORKFLOW', 'AUDIT']),
  actionType: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  isInternal: z.boolean(),
  actorUserId: z.number().int().nullable(),
  actorFullName: z.string().nullable(),
  actorUsername: z.string().nullable(),
  occurredAt: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export const recordActivityTimelineResponseSchema = z.object({
  entityType: z.string(),
  entityId: z.string(),
  totalItems: z.number().int().min(0),
  items: z.array(recordActivityTimelineEntryResponseSchema),
});

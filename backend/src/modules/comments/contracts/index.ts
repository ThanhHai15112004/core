import type { UserIdentity } from '@packages/security/index.js';

export interface RecordCommentEditHistoryItemView {
  readonly previousContent: string;
  readonly previousAttachmentFileIds: readonly number[];
  readonly editedByUserId: number | null;
  readonly editedByFullName: string | null;
  readonly editedAt: string;
  readonly editReason: string | null;
}

export interface RecordCommentAttachmentItemView {
  readonly fileId: number;
  readonly code: string;
  readonly displayName: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sizeFormatted: string;
}

export interface RecordCommentMentionItemView {
  readonly userId: number;
  readonly username: string | null;
  readonly fullName: string | null;
}

export interface RecordCommentItemView {
  readonly id: number;
  readonly entityType: string;
  readonly entityId: string;
  readonly workflowInstanceId: number | null;
  readonly parentCommentId: number | null;
  readonly content: string;
  readonly isInternal: boolean;
  readonly authorUserId: number | null;
  readonly authorFullName: string | null;
  readonly authorUsername: string | null;
  readonly mentions: readonly RecordCommentMentionItemView[];
  readonly attachmentFileIds: readonly number[];
  readonly attachments: readonly RecordCommentAttachmentItemView[];
  readonly editHistories: readonly RecordCommentEditHistoryItemView[];
  readonly replies: readonly RecordCommentItemView[];
  readonly isEdited: boolean;
  readonly isDeleted: boolean;
  readonly deletedAt: string | null;
  readonly deletedByUserId: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type RecordActivityTimelineSource = 'COMMENT' | 'WORKFLOW' | 'AUDIT';

export interface RecordActivityTimelineEntryView {
  readonly id: string;
  readonly source: RecordActivityTimelineSource;
  readonly actionType: string;
  readonly title: string;
  readonly summary: string | null;
  readonly isInternal: boolean;
  readonly actorUserId: number | null;
  readonly actorFullName: string | null;
  readonly actorUsername: string | null;
  readonly occurredAt: string;
  readonly metadata: Record<string, unknown> | null;
}

export interface RecordActivityTimelineView {
  readonly entityType: string;
  readonly entityId: string;
  readonly totalItems: number;
  readonly items: readonly RecordActivityTimelineEntryView[];
}

export interface CreateRecordCommentInput {
  readonly entityType: string;
  readonly entityId: string;
  readonly workflowInstanceId?: number | null | undefined;
  readonly parentCommentId?: number | null | undefined;
  readonly content: string;
  readonly isInternal?: boolean | undefined;
  readonly mentionedUserIds?: readonly number[] | undefined;
  readonly attachmentFileIds?: readonly number[] | undefined;
}

export interface UpdateRecordCommentInput {
  readonly content: string;
  readonly mentionedUserIds?: readonly number[] | undefined;
  readonly attachmentFileIds?: readonly number[] | undefined;
  readonly editReason?: string | null | undefined;
}

export interface ListRecordCommentsQueryInput {
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly workflowInstanceId?: number | undefined;
  readonly includeInternal?: boolean | undefined;
  readonly includeDeleted?: boolean | undefined;
}

export interface GetRecordActivityTimelineQueryInput {
  readonly entityType: string;
  readonly entityId: string;
  readonly workflowInstanceId?: number | undefined;
  readonly includeInternal?: boolean | undefined;
  readonly source?: 'ALL' | 'COMMENT' | 'WORKFLOW' | 'AUDIT' | undefined;
  readonly sortOrder?: 'ASC' | 'DESC' | undefined;
  readonly limit?: number | undefined;
}

export interface ICommentsPublicService {
  createComment(
    input: CreateRecordCommentInput,
    actor?: UserIdentity,
  ): Promise<RecordCommentItemView>;
  listComments(
    query: ListRecordCommentsQueryInput,
    actor?: UserIdentity,
  ): Promise<RecordCommentItemView[]>;
  updateComment(
    id: number,
    input: UpdateRecordCommentInput,
    actor?: UserIdentity,
    now?: Date,
  ): Promise<RecordCommentItemView>;
  deleteComment(
    id: number,
    actor?: UserIdentity,
    now?: Date,
  ): Promise<RecordCommentItemView & { readonly id: number; readonly deleted: true }>;
  getRecordTimeline(
    query: GetRecordActivityTimelineQueryInput,
    actor?: UserIdentity,
  ): Promise<RecordActivityTimelineView>;
  registerWorkflowTimelineEntriesProvider?(
    provider: (params: {
      readonly entityType: string;
      readonly entityId: string;
      readonly workflowInstanceId?: number | undefined;
    }) => Promise<readonly RecordActivityTimelineEntryView[]>,
  ): void;
}

export const COMMENTS_PUBLIC_SERVICE = Symbol('COMMENTS_PUBLIC_SERVICE');

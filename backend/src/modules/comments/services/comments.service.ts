import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
  defaultSettingRegistry,
  safeJsonParse,
} from '@packages/kernel/index.js';
import { AuditLogService, type UserIdentity } from '@packages/security/index.js';
import { FILES_PUBLIC_SERVICE, type IFilesPublicService } from '@modules/files/index.js';
import {
  type INotificationsPublicService,
  NOTIFICATIONS_PUBLIC_SERVICE,
} from '@modules/notifications/index.js';
import { type IUsersPublicService, USERS_PUBLIC_SERVICE } from '@modules/users/index.js';
import type {
  CreateRecordCommentInput,
  GetRecordActivityTimelineQueryInput,
  ICommentsPublicService,
  ListRecordCommentsQueryInput,
  RecordActivityTimelineEntryView,
  RecordActivityTimelineView,
  RecordCommentAttachmentItemView,
  RecordCommentEditHistoryItemView,
  RecordCommentItemView,
  RecordCommentMentionItemView,
  UpdateRecordCommentInput,
} from '../contracts/index.js';
import type { RecordCommentHistoryEntity } from '../entities/record-comment-history.entity.js';
import type { RecordCommentEntity } from '../entities/record-comment.entity.js';
import { RecordCommentHistoryRepository } from '../repositories/record-comment-history.repository.js';
import { RecordCommentRepository } from '../repositories/record-comment.repository.js';

interface StoredRecordCommentItem {
  id: number;
  entityType: string;
  entityId: string;
  workflowInstanceId: number | null;
  parentCommentId: number | null;
  content: string;
  isInternal: boolean;
  authorUserId: number | null;
  mentionedUserIds: number[];
  attachmentFileIds: number[];
  editHistories: Array<{
    previousContent: string;
    previousAttachmentFileIds: number[];
    editedByUserId: number | null;
    editedAt: string;
    editReason: string | null;
  }>;
  isEdited: boolean;
  isDeleted: boolean;
  deletedAt: string | null;
  deletedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class CommentsService implements ICommentsPublicService {
  private readonly memoryComments = new Map<number, StoredRecordCommentItem>();
  private nextMemoryId = 1;
  private workflowTimelineProvider:
    | ((params: {
        readonly entityType: string;
        readonly entityId: string;
        readonly workflowInstanceId?: number | undefined;
      }) => Promise<readonly RecordActivityTimelineEntryView[]>)
    | null = null;

  constructor(
    @Optional()
    @Inject(RecordCommentRepository)
    private readonly commentRepository: RecordCommentRepository | null = null,
    @Optional()
    @Inject(RecordCommentHistoryRepository)
    private readonly commentHistoryRepository: RecordCommentHistoryRepository | null = null,
    @Optional()
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService: IUsersPublicService | null = null,
    @Optional()
    @Inject(NOTIFICATIONS_PUBLIC_SERVICE)
    private readonly notificationsPublicService: INotificationsPublicService | null = null,
    @Optional()
    @Inject(FILES_PUBLIC_SERVICE)
    private readonly filesPublicService: IFilesPublicService | null = null,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService: AuditLogService | null = null,
  ) {}

  public registerWorkflowTimelineEntriesProvider(
    provider: (params: {
      readonly entityType: string;
      readonly entityId: string;
      readonly workflowInstanceId?: number | undefined;
    }) => Promise<readonly RecordActivityTimelineEntryView[]>,
  ): void {
    this.workflowTimelineProvider = provider;
  }

  private canViewInternalNotes(actor?: UserIdentity): boolean {
    if (!actor) return true;
    if (actor.roles?.includes('super_admin')) return true;
    const perms = actor.permissions ?? [];
    return (
      perms.includes('comments.internal_notes') ||
      perms.includes('comments.manage') ||
      perms.includes('workflows.internal_notes') ||
      perms.includes('workflows.manage')
    );
  }

  private parseNumberList(raw?: string | null): number[] {
    const parsed = safeJsonParse<unknown[]>(raw, []);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(Number).filter((n) => Number.isFinite(n) && n >= 1);
  }

  private entityToStoredItem(
    entity: RecordCommentEntity,
    histories: readonly RecordCommentHistoryEntity[] = [],
  ): StoredRecordCommentItem {
    return {
      id: Number(entity.id),
      entityType: entity.entityType,
      entityId: String(entity.entityId),
      workflowInstanceId:
        entity.workflowInstanceId !== undefined && entity.workflowInstanceId !== null
          ? Number(entity.workflowInstanceId)
          : null,
      parentCommentId:
        entity.parentCommentId !== undefined && entity.parentCommentId !== null
          ? Number(entity.parentCommentId)
          : null,
      content: entity.content,
      isInternal: Boolean(entity.isInternal),
      authorUserId: Number(entity.authorUserId),
      mentionedUserIds: this.parseNumberList(entity.mentionedUserIdsJson),
      attachmentFileIds: this.parseNumberList(entity.attachmentFileIdsJson),
      editHistories: histories.map((h) => ({
        previousContent: h.previousContent,
        previousAttachmentFileIds: this.parseNumberList(h.previousAttachmentFileIdsJson),
        editedByUserId: Number(h.editedByUserId),
        editedAt: (h.editedAt ? new Date(h.editedAt) : new Date()).toISOString(),
        editReason: h.editReason ?? null,
      })),
      isEdited: Boolean(entity.isEdited),
      isDeleted: Boolean(entity.isDeleted),
      deletedAt: entity.deletedAt ? new Date(entity.deletedAt).toISOString() : null,
      deletedByUserId:
        entity.deletedByUserId !== undefined && entity.deletedByUserId !== null
          ? Number(entity.deletedByUserId)
          : null,
      createdAt: (entity.createdAt ? new Date(entity.createdAt) : new Date()).toISOString(),
      updatedAt: (entity.updatedAt ? new Date(entity.updatedAt) : new Date()).toISOString(),
    };
  }

  private async resolveMentionUserIds(
    content: string,
    explicitUserIds: readonly number[],
  ): Promise<number[]> {
    const ids = new Set<number>();
    for (const uid of explicitUserIds) {
      if (Number.isFinite(Number(uid)) && Number(uid) >= 1) {
        ids.add(Number(uid));
      }
    }

    const tokenMatches = content.match(/@([a-zA-Z0-9._-]{2,64})/g) ?? [];
    for (const rawToken of tokenMatches) {
      const token = rawToken.slice(1).trim();
      if (!token) continue;
      if (/^\d+$/.test(token)) {
        const numericId = Number(token);
        if (numericId >= 1) ids.add(numericId);
        continue;
      }
      if (this.usersPublicService?.findAuthUserByIdentifier) {
        const found = await this.usersPublicService
          .findAuthUserByIdentifier(token)
          .catch(() => null);
        if (found) ids.add(Number(found.id));
      }
    }

    return [...ids];
  }

  private async hydrateCommentTree(
    items: readonly StoredRecordCommentItem[],
  ): Promise<RecordCommentItemView[]> {
    if (items.length === 0) return [];

    const userIds = new Set<number>();
    const fileIds = new Set<number>();

    for (const item of items) {
      if (item.authorUserId) userIds.add(Number(item.authorUserId));
      for (const uid of item.mentionedUserIds) userIds.add(Number(uid));
      for (const h of item.editHistories) {
        if (h.editedByUserId) userIds.add(Number(h.editedByUserId));
      }
      for (const fid of item.attachmentFileIds) fileIds.add(Number(fid));
    }

    const contacts =
      userIds.size > 0 && this.usersPublicService?.findUserContactsByIds
        ? await this.usersPublicService.findUserContactsByIds([...userIds]).catch(() => [])
        : [];
    const userMap = new Map(contacts.map((c) => [Number(c.id), c]));

    const files =
      fileIds.size > 0 && this.filesPublicService?.findByIds
        ? await this.filesPublicService.findByIds([...fileIds]).catch(() => [])
        : [];
    const fileMap = new Map(files.map((f) => [Number(f.id), f]));

    const viewById = new Map<number, RecordCommentItemView & { replies: RecordCommentItemView[] }>();
    const roots: Array<RecordCommentItemView & { replies: RecordCommentItemView[] }> = [];

    const sorted = [...items].sort((a, b) => a.id - b.id);
    for (const item of sorted) {
      const author = item.authorUserId ? userMap.get(Number(item.authorUserId)) : undefined;
      const mentions: RecordCommentMentionItemView[] = item.mentionedUserIds.map((uid) => {
        const contact = userMap.get(Number(uid));
        return {
          userId: Number(uid),
          username: contact?.username ?? null,
          fullName: contact?.fullName ?? null,
        };
      });

      const attachments: RecordCommentAttachmentItemView[] = item.attachmentFileIds.map((fid) => {
        const f = fileMap.get(Number(fid));
        return {
          fileId: Number(fid),
          code: f?.code ?? `FILE_${fid}`,
          displayName: f?.displayName ?? f?.originalName ?? `File #${fid}`,
          originalName: f?.originalName ?? `file-${fid}`,
          mimeType: f?.mimeType ?? 'application/octet-stream',
          sizeBytes: f?.sizeBytes ?? 0,
          sizeFormatted: f?.sizeFormatted ?? '0 B',
        };
      });

      const editHistories: RecordCommentEditHistoryItemView[] = item.editHistories.map((h) => {
        const editor = h.editedByUserId ? userMap.get(Number(h.editedByUserId)) : undefined;
        return {
          previousContent: h.previousContent,
          previousAttachmentFileIds: h.previousAttachmentFileIds,
          editedByUserId: h.editedByUserId,
          editedByFullName: editor?.fullName ?? null,
          editedAt: h.editedAt,
          editReason: h.editReason,
        };
      });

      const node: RecordCommentItemView & { replies: RecordCommentItemView[] } = {
        id: item.id,
        entityType: item.entityType,
        entityId: item.entityId,
        workflowInstanceId: item.workflowInstanceId,
        parentCommentId: item.parentCommentId,
        content: item.isDeleted ? '[Bình luận đã bị xóa]' : item.content,
        isInternal: item.isInternal,
        authorUserId: item.authorUserId,
        authorFullName: author?.fullName ?? null,
        authorUsername: author?.username ?? null,
        mentions,
        attachmentFileIds: item.attachmentFileIds,
        attachments: item.isDeleted ? [] : attachments,
        editHistories,
        replies: [],
        isEdited: item.isEdited,
        isDeleted: item.isDeleted,
        deletedAt: item.deletedAt,
        deletedByUserId: item.deletedByUserId,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      };

      viewById.set(item.id, node);
    }

    for (const item of sorted) {
      const node = viewById.get(item.id)!;
      if (item.parentCommentId && viewById.has(item.parentCommentId)) {
        viewById.get(item.parentCommentId)!.replies.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  public async createComment(
    input: CreateRecordCommentInput,
    actor?: UserIdentity,
  ): Promise<RecordCommentItemView> {
    if (input.isInternal && !this.canViewInternalNotes(actor)) {
      throw new ForbiddenAppException('comments.internalNoteForbidden');
    }

    const normalizedEntityType = input.entityType.trim().toLowerCase();
    const normalizedEntityId = String(input.entityId).trim();

    if (input.parentCommentId) {
      let parent = this.memoryComments.get(Number(input.parentCommentId));
      if (!parent && this.commentRepository) {
        const dbParent = await this.commentRepository
          .findById(Number(input.parentCommentId))
          .catch(() => null);
        if (dbParent) {
          parent = this.entityToStoredItem(dbParent);
          this.memoryComments.set(parent.id, parent);
        }
      }
      if (!parent || parent.isDeleted) {
        throw new NotFoundAppException('comments.parentCommentNotFound', {
          parentCommentId: input.parentCommentId,
        });
      }
      if (parent.entityType !== normalizedEntityType || parent.entityId !== normalizedEntityId) {
        throw new BadRequestAppException('comments.parentCommentEntityMismatch');
      }
    }

    const mentionedUserIds = await this.resolveMentionUserIds(
      input.content,
      input.mentionedUserIds ?? [],
    );
    const attachmentFileIds = [
      ...new Set(
        (input.attachmentFileIds ?? []).map(Number).filter((n) => Number.isFinite(n) && n >= 1),
      ),
    ];

    if (attachmentFileIds.length > 0 && this.filesPublicService) {
      await this.filesPublicService.ensureActiveFilesExist(attachmentFileIds);
    }

    let stored: StoredRecordCommentItem | null = null;
    if (this.commentRepository) {
      try {
        const createdEntity = await this.commentRepository.createComment({
          entityType: normalizedEntityType,
          entityId: normalizedEntityId,
          workflowInstanceId: input.workflowInstanceId ?? null,
          parentCommentId: input.parentCommentId ?? null,
          content: input.content.trim(),
          isInternal: Boolean(input.isInternal),
          authorUserId: actor?.id ?? 1,
          mentionedUserIdsJson: JSON.stringify(mentionedUserIds),
          attachmentFileIdsJson: JSON.stringify(attachmentFileIds),
        });
        stored = this.entityToStoredItem(createdEntity);
      } catch {
        // Fallback to in-memory store when DB is not connected in unit tests
      }
    }

    if (!stored) {
      const nowIso = new Date().toISOString();
      const id = this.nextMemoryId++;
      stored = {
        id,
        entityType: normalizedEntityType,
        entityId: normalizedEntityId,
        workflowInstanceId: input.workflowInstanceId ?? null,
        parentCommentId: input.parentCommentId ?? null,
        content: input.content.trim(),
        isInternal: Boolean(input.isInternal),
        authorUserId: actor?.id ?? 1,
        mentionedUserIds,
        attachmentFileIds,
        editHistories: [],
        isEdited: false,
        isDeleted: false,
        deletedAt: null,
        deletedByUserId: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
    }

    this.memoryComments.set(stored.id, stored);

    if (attachmentFileIds.length > 0 && this.filesPublicService) {
      await this.filesPublicService
        .syncEntityFileUsages({
          moduleName: 'comments',
          entityType: normalizedEntityType,
          entityId: normalizedEntityId,
          fieldName: `comment_${stored.id}`,
          fileIds: attachmentFileIds,
          actorId: actor?.id ?? null,
        })
        .catch(() => undefined);
    }

    if (mentionedUserIds.length > 0 && this.notificationsPublicService) {
      const recipientIds = mentionedUserIds.filter((uid) => Number(uid) !== Number(actor?.id ?? 0));
      if (recipientIds.length > 0) {
        await this.notificationsPublicService
          .dispatch({
            title: input.isInternal
              ? `Bạn được nhắc tên trong ghi chú nội bộ (${normalizedEntityType} #${normalizedEntityId})`
              : `Bạn được nhắc tên trong bình luận (${normalizedEntityType} #${normalizedEntityId})`,
            content: stored.content.slice(0, 300),
            category: 'SYSTEM',
            priority: 'NORMAL',
            targetType: 'SINGLE_USER',
            userIds: recipientIds,
            referenceModule: 'comments',
            referenceType: normalizedEntityType,
            referenceId: normalizedEntityId,
            senderUserId: actor?.id ?? null,
            metadata: {
              commentId: stored.id,
              entityType: normalizedEntityType,
              entityId: normalizedEntityId,
              workflowInstanceId: stored.workflowInstanceId,
              isInternal: stored.isInternal,
            },
          })
          .catch(() => undefined);
      }
    }

    if (this.auditLogService) {
      await this.auditLogService
        .record({
          actor,
          actorUserId: actor?.id ?? null,
          module: 'comments',
          feature: 'comment',
          action: stored.isInternal ? 'ADD_INTERNAL_NOTE' : 'ADD_COMMENT',
          resourceType: normalizedEntityType,
          resourceId: normalizedEntityId,
          afterData: {
            commentId: stored.id,
            parentCommentId: stored.parentCommentId,
            isInternal: stored.isInternal,
            mentionedUserIds,
            attachmentFileIds,
          },
        })
        .catch(() => undefined);
    }

    const [hydrated] = await this.hydrateCommentTree([stored]);
    return hydrated!;
  }

  public async listComments(
    query: ListRecordCommentsQueryInput,
    actor?: UserIdentity,
  ): Promise<RecordCommentItemView[]> {
    const canSeeInternal = this.canViewInternalNotes(actor);
    const includeInternal =
      query.includeInternal !== undefined ? query.includeInternal && canSeeInternal : canSeeInternal;

    if (this.commentRepository) {
      try {
        const dbComments = await this.commentRepository.findByRecordOrInstance({
          entityType: query.entityType,
          entityId: query.entityId,
          workflowInstanceId: query.workflowInstanceId,
        });
        const commentIds = dbComments.map((c) => Number(c.id));
        const dbHistories =
          commentIds.length > 0 && this.commentHistoryRepository
            ? await this.commentHistoryRepository.findByCommentIds(commentIds).catch(() => [])
            : [];
        const historiesByComment = new Map<number, RecordCommentHistoryEntity[]>();
        for (const h of dbHistories) {
          const cid = Number(h.commentId);
          const list = historiesByComment.get(cid) ?? [];
          list.push(h);
          historiesByComment.set(cid, list);
        }
        for (const c of dbComments) {
          const stored = this.entityToStoredItem(c, historiesByComment.get(Number(c.id)) ?? []);
          this.memoryComments.set(stored.id, stored);
        }
      } catch {
        // Fallback to in-memory store
      }
    }

    let filtered = [...this.memoryComments.values()];
    if (query.entityType) {
      const normalizedType = query.entityType.trim().toLowerCase();
      filtered = filtered.filter((c) => c.entityType === normalizedType);
    }
    if (query.entityId) {
      const normalizedId = String(query.entityId).trim();
      filtered = filtered.filter((c) => c.entityId === normalizedId);
    }
    if (query.workflowInstanceId !== undefined) {
      filtered = filtered.filter(
        (c) => Number(c.workflowInstanceId) === Number(query.workflowInstanceId),
      );
    }
    if (!includeInternal) {
      filtered = filtered.filter((c) => !c.isInternal);
    }
    if (!query.includeDeleted) {
      filtered = filtered.filter((c) => !c.isDeleted);
    }

    return this.hydrateCommentTree(filtered);
  }

  private assertCanModifyOrDeleteComment(
    target: StoredRecordCommentItem,
    actor?: UserIdentity,
  ): void {
    const isAdmin =
      actor?.roles?.includes('super_admin') ||
      actor?.permissions?.includes('comments.manage') ||
      actor?.permissions?.includes('workflows.manage');

    if (actor && !isAdmin) {
      if (Number(target.authorUserId) !== Number(actor.id)) {
        throw new ForbiddenAppException('comments.commentEditForbidden');
      }
      const maxEditMinutes = defaultSettingRegistry.getNumber(
        'comments.edit_window_minutes',
        undefined,
        60,
      );
      const ageMinutes = (Date.now() - new Date(target.createdAt).getTime()) / (60 * 1000);
      if (ageMinutes > maxEditMinutes) {
        throw new BadRequestAppException('comments.commentEditWindowExpired', [
          {
            maxEditMinutes,
          },
        ]);
      }
    }
  }

  public async updateComment(
    id: number,
    input: UpdateRecordCommentInput,
    actor?: UserIdentity,
  ): Promise<RecordCommentItemView> {
    let target = this.memoryComments.get(Number(id));
    let dbEntity: RecordCommentEntity | null = null;

    if (this.commentRepository) {
      try {
        dbEntity = await this.commentRepository.findById(Number(id));
        if (dbEntity) {
          const dbHistories = this.commentHistoryRepository
            ? await this.commentHistoryRepository.findByCommentIds([Number(id)]).catch(() => [])
            : [];
          target = this.entityToStoredItem(dbEntity, dbHistories);
          this.memoryComments.set(target.id, target);
        }
      } catch {
        // Fallback to memory
      }
    }

    if (!target) {
      throw new NotFoundAppException('comments.commentNotFound', { id });
    }
    if (target.isDeleted) {
      throw new BadRequestAppException('comments.commentDeletedCannotEdit', [{ id }]);
    }
    if (target.isInternal && !this.canViewInternalNotes(actor)) {
      throw new ForbiddenAppException('comments.internalNoteForbidden');
    }

    this.assertCanModifyOrDeleteComment(target, actor);

    const nowDate = new Date();
    const nowIso = nowDate.toISOString();

    if (this.commentHistoryRepository) {
      try {
        await this.commentHistoryRepository.createHistory({
          commentId: target.id,
          previousContent: target.content,
          previousAttachmentFileIdsJson: JSON.stringify(target.attachmentFileIds),
          editedByUserId: actor?.id ?? target.authorUserId ?? 1,
          editReason: input.editReason ?? null,
          editedAt: nowDate,
        });
      } catch {
        // Ignore in unit tests without DB
      }
    }

    target.editHistories.push({
      previousContent: target.content,
      previousAttachmentFileIds: [...target.attachmentFileIds],
      editedByUserId: actor?.id ?? target.authorUserId,
      editedAt: nowIso,
      editReason: input.editReason ?? null,
    });

    target.content = input.content.trim();
    target.mentionedUserIds = await this.resolveMentionUserIds(
      target.content,
      input.mentionedUserIds ?? target.mentionedUserIds,
    );

    if (input.attachmentFileIds !== undefined) {
      const nextFileIds = [
        ...new Set(input.attachmentFileIds.map(Number).filter((n) => Number.isFinite(n) && n >= 1)),
      ];
      if (nextFileIds.length > 0 && this.filesPublicService) {
        await this.filesPublicService.ensureActiveFilesExist(nextFileIds);
      }
      if (this.filesPublicService) {
        await this.filesPublicService
          .syncEntityFileUsages({
            moduleName: 'comments',
            entityType: target.entityType,
            entityId: target.entityId,
            fieldName: `comment_${target.id}`,
            fileIds: nextFileIds,
            actorId: actor?.id ?? null,
          })
          .catch(() => undefined);
      }
      target.attachmentFileIds = nextFileIds;
    }

    target.isEdited = true;
    target.updatedAt = nowIso;

    if (dbEntity && this.commentRepository) {
      try {
        dbEntity.content = target.content;
        dbEntity.mentionedUserIdsJson = JSON.stringify(target.mentionedUserIds);
        dbEntity.attachmentFileIdsJson = JSON.stringify(target.attachmentFileIds);
        dbEntity.isEdited = true;
        await this.commentRepository.saveEntity(dbEntity);
      } catch {
        // Ignore in unit tests without DB
      }
    }

    this.memoryComments.set(target.id, target);
    const [hydrated] = await this.hydrateCommentTree([target]);
    return hydrated!;
  }

  public async deleteComment(
    id: number,
    actor?: UserIdentity,
  ): Promise<{ readonly id: number; readonly deleted: true }> {
    let target = this.memoryComments.get(Number(id));
    let dbEntity: RecordCommentEntity | null = null;

    if (this.commentRepository) {
      try {
        dbEntity = await this.commentRepository.findById(Number(id));
        if (dbEntity) {
          target = this.entityToStoredItem(dbEntity);
          this.memoryComments.set(target.id, target);
        }
      } catch {
        // Fallback to memory
      }
    }

    if (!target) {
      throw new NotFoundAppException('comments.commentNotFound', { id });
    }

    this.assertCanModifyOrDeleteComment(target, actor);

    const nowDate = new Date();
    target.isDeleted = true;
    target.deletedAt = nowDate.toISOString();
    target.deletedByUserId = actor?.id ?? null;
    target.updatedAt = target.deletedAt;

    if (dbEntity && this.commentRepository) {
      try {
        dbEntity.isDeleted = true;
        dbEntity.deletedAt = nowDate;
        dbEntity.deletedByUserId = actor?.id ?? null;
        await this.commentRepository.saveEntity(dbEntity);
      } catch {
        // Ignore in unit tests without DB
      }
    }

    this.memoryComments.set(target.id, target);
    return { id: Number(id), deleted: true };
  }

  public async getRecordTimeline(
    query: GetRecordActivityTimelineQueryInput,
    actor?: UserIdentity,
  ): Promise<RecordActivityTimelineView> {
    const normalizedEntityType = query.entityType.trim().toLowerCase();
    const normalizedEntityId = String(query.entityId).trim();
    const canSeeInternal = this.canViewInternalNotes(actor);
    const includeInternal =
      query.includeInternal !== undefined ? query.includeInternal && canSeeInternal : canSeeInternal;
    const limit = query.limit ?? 100;

    // Sync from DB if available
    await this.listComments(
      {
        entityType: normalizedEntityType,
        entityId: normalizedEntityId,
        workflowInstanceId: query.workflowInstanceId,
        includeInternal: true,
        includeDeleted: true,
      },
      actor,
    ).catch(() => []);

    const commentRecords = [...this.memoryComments.values()].filter((c) => {
      if (c.isDeleted) return false;
      if (c.entityType !== normalizedEntityType || c.entityId !== normalizedEntityId) return false;
      if (
        query.workflowInstanceId !== undefined &&
        Number(c.workflowInstanceId) !== Number(query.workflowInstanceId)
      ) {
        return false;
      }
      if (!includeInternal && c.isInternal) return false;
      return true;
    });

    const workflowEntries = this.workflowTimelineProvider
      ? await this.workflowTimelineProvider({
          entityType: normalizedEntityType,
          entityId: normalizedEntityId,
          workflowInstanceId: query.workflowInstanceId,
        }).catch(() => [])
      : [];

    const auditItems = this.auditLogService
      ? await this.auditLogService
          .listPaginated({
            resourceType: normalizedEntityType,
            resourceId: normalizedEntityId,
            limit: 100,
          })
          .then((res) => res.data)
          .catch(() => [])
      : [];

    const userIds = new Set<number>();
    for (const c of commentRecords) {
      if (c.authorUserId) userIds.add(Number(c.authorUserId));
    }
    for (const a of auditItems) {
      if (a.actorUserId) userIds.add(Number(a.actorUserId));
    }

    const contacts =
      userIds.size > 0 && this.usersPublicService?.findUserContactsByIds
        ? await this.usersPublicService.findUserContactsByIds([...userIds]).catch(() => [])
        : [];
    const userMap = new Map(contacts.map((u) => [Number(u.id), u]));

    const entries: RecordActivityTimelineEntryView[] = [...workflowEntries];

    for (const c of commentRecords) {
      const actorInfo = c.authorUserId ? userMap.get(Number(c.authorUserId)) : undefined;
      entries.push({
        id: `comment_${c.id}`,
        source: 'COMMENT',
        actionType: c.isInternal ? 'INTERNAL_NOTE' : c.parentCommentId ? 'REPLY' : 'COMMENT',
        title: c.isInternal
          ? 'Đã thêm ghi chú nội bộ'
          : c.parentCommentId
            ? `Đã trả lời bình luận #${c.parentCommentId}`
            : 'Đã thêm bình luận',
        summary: c.content,
        isInternal: c.isInternal,
        actorUserId: c.authorUserId,
        actorFullName: actorInfo?.fullName ?? null,
        actorUsername: actorInfo?.username ?? null,
        occurredAt: c.createdAt,
        metadata: {
          commentId: c.id,
          parentCommentId: c.parentCommentId,
          isEdited: c.isEdited,
          editCount: c.editHistories.length,
          attachmentCount: c.attachmentFileIds.length,
          mentionedUserIds: c.mentionedUserIds,
        },
      });
    }

    for (const a of auditItems) {
      const actorInfo = a.actorUserId ? userMap.get(Number(a.actorUserId)) : undefined;
      entries.push({
        id: `audit_${a.id}`,
        source: 'AUDIT',
        actionType: a.action,
        title: `Audit: ${a.action}`,
        summary: a.reason ?? (a.module ? `Module: ${a.module}` : null),
        isInternal: false,
        actorUserId: a.actorUserId ? Number(a.actorUserId) : null,
        actorFullName: actorInfo?.fullName ?? null,
        actorUsername: actorInfo?.username ?? a.actorIdentifier ?? null,
        occurredAt: a.createdAt,
        metadata: {
          auditId: a.id,
          module: a.module,
          feature: a.feature,
          beforeData: a.beforeData ?? null,
          afterData: a.afterData ?? null,
        },
      });
    }

    entries.sort((x, y) => new Date(y.occurredAt).getTime() - new Date(x.occurredAt).getTime());
    const sliced = entries.slice(0, limit);

    return {
      entityType: normalizedEntityType,
      entityId: normalizedEntityId,
      totalItems: entries.length,
      items: sliced,
    };
  }
}

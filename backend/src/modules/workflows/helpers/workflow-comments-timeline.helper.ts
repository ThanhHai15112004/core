import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
  defaultSettingRegistry,
  safeJsonParseObject,
} from '@packages/kernel/index.js';
import type { AuditLogService, UserIdentity } from '@packages/security/index.js';
import type { IFilesPublicService } from '@modules/files/contracts/index.js';
import type { INotificationsPublicService } from '@modules/notifications/contracts/index.js';
import type { IUsersPublicService } from '@modules/users/contracts/index.js';
import {
  WORKFLOWS_AUDIT_META,
  WORKFLOWS_SETTING_KEYS,
  type WorkflowActivityTimelineEntryView,
  type WorkflowCommentAttachmentItemView,
  type WorkflowCommentEditHistoryItemView,
  type WorkflowCommentItemView,
  type WorkflowCommentMentionItemView,
  type WorkflowRecordActivityTimelineView,
} from '../contracts/index.js';
import type { WorkflowHistoryRepository } from '../repositories/workflow-history.repository.js';
import type { WorkflowInstanceRepository } from '../repositories/workflow-instance.repository.js';
import type {
  CreateWorkflowCommentRequest,
  ListWorkflowCommentsQuery,
  ListWorkflowTimelineQuery,
  UpdateWorkflowCommentRequest,
} from '../requests/workflows.requests.js';
import { resolveUserContactsMap } from './workflow-hydration.helper.js';

async function resolveUserDisplayMap(
  userIds: readonly number[],
  usersPublicService: IUsersPublicService | null,
): Promise<Map<number, { fullName: string | null; username: string | null }>> {
  const map = new Map<number, { fullName: string | null; username: string | null }>();
  if (!usersPublicService || userIds.length === 0) return map;

  const contactsMap = await resolveUserContactsMap(userIds, usersPublicService);
  for (const [id, c] of contactsMap.entries()) {
    map.set(id, { fullName: c.fullName, username: c.username });
  }
  if (map.size > 0) return map;

  const fallbackFinder = (
    usersPublicService as unknown as {
      findUsersByIds?: (
        ids: readonly number[],
      ) => Promise<ReadonlyArray<{ id: number; fullName: string | null; username: string | null }>>;
    }
  ).findUsersByIds;
  if (typeof fallbackFinder === 'function') {
    const list = await fallbackFinder(userIds).catch(() => []);
    for (const u of list) {
      map.set(Number(u.id), { fullName: u.fullName, username: u.username });
    }
  }
  return map;
}

export interface StoredWorkflowCommentRecord {
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
  attachments: WorkflowCommentAttachmentItemView[];
  editHistories: WorkflowCommentEditHistoryItemView[];
  isEdited: boolean;
  isDeleted: boolean;
  deletedAt: string | null;
  deletedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export function canActorManageComments(actor?: UserIdentity): boolean {
  if (!actor) return false;
  const roles = (actor.roles ?? []).map((r) => r.toLowerCase());
  if (roles.includes('admin') || roles.includes('super_admin')) {
    return true;
  }
  const perms = actor.permissions ?? [];
  return perms.includes('*') || perms.includes('workflows.manage');
}

export function canActorAccessInternalNotes(actor?: UserIdentity): boolean {
  if (!actor) return false;
  if (canActorManageComments(actor)) return true;
  const perms = actor.permissions ?? [];
  return perms.includes('workflows.internal_notes');
}

export function extractMentionedUserIds(
  content: string,
  explicitIds?: readonly number[],
): number[] {
  const result = new Set<number>();
  if (explicitIds) {
    for (const id of explicitIds) {
      const num = Number(id);
      if (Number.isInteger(num) && num > 0) {
        result.add(num);
      }
    }
  }
  const regex = /@(?:user_)?(\d+)\b/gi;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(content)) !== null) {
    const parsed = Number(match[1]);
    if (Number.isInteger(parsed) && parsed > 0) {
      result.add(parsed);
    }
  }
  return [...result];
}

async function resolveAttachments(
  fileIds: readonly number[],
  filesPublicService: IFilesPublicService | null,
  syncTarget?: { commentId: number; actorId: number | null },
): Promise<WorkflowCommentAttachmentItemView[]> {
  const uniqueIds = [...new Set(fileIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!filesPublicService) {
    return uniqueIds.map((fileId) => ({
      fileId,
      code: `FILE_${fileId}`,
      displayName: `Tệp đính kèm #${fileId}`,
      originalName: `attachment-${fileId}.dat`,
      mimeType: 'application/octet-stream',
      sizeBytes: 0,
      sizeFormatted: '0 B',
    }));
  }

  const summaries =
    uniqueIds.length > 0 ? await filesPublicService.ensureActiveFilesExist(uniqueIds) : [];

  if (syncTarget) {
    await filesPublicService.syncEntityFileUsages({
      moduleName: WORKFLOWS_AUDIT_META.MODULE,
      entityType: WORKFLOWS_AUDIT_META.RESOURCE_TYPES.COMMENT,
      entityId: syncTarget.commentId,
      fieldName: 'attachments',
      fileIds: uniqueIds,
      actorId: syncTarget.actorId,
    });
  }

  return summaries.map((f) => ({
    fileId: Number(f.id),
    code: f.code,
    displayName: f.displayName,
    originalName: f.originalName,
    mimeType: f.mimeType,
    sizeBytes: Number(f.sizeBytes),
    sizeFormatted: f.sizeFormatted,
  }));
}

async function hydrateCommentsTree(
  records: readonly StoredWorkflowCommentRecord[],
  usersPublicService: IUsersPublicService | null,
  sortOrder: 'ASC' | 'DESC' = 'ASC',
): Promise<WorkflowCommentItemView[]> {
  const userIds = new Set<number>();
  for (const r of records) {
    if (r.authorUserId) userIds.add(Number(r.authorUserId));
    for (const mId of r.mentionedUserIds) userIds.add(Number(mId));
    for (const eh of r.editHistories) {
      if (eh.editedByUserId) userIds.add(Number(eh.editedByUserId));
    }
  }

  const userMap = await resolveUserDisplayMap([...userIds], usersPublicService);

  const toView = (
    r: StoredWorkflowCommentRecord,
    replies: readonly WorkflowCommentItemView[],
  ): WorkflowCommentItemView => {
    const author = r.authorUserId ? userMap.get(Number(r.authorUserId)) : undefined;
    const mentions: WorkflowCommentMentionItemView[] = r.mentionedUserIds.map((uid) => {
      const u = userMap.get(Number(uid));
      return {
        userId: Number(uid),
        username: u?.username ?? `user_${uid}`,
        fullName: u?.fullName ?? null,
      };
    });
    const editHistories: WorkflowCommentEditHistoryItemView[] = r.editHistories.map((eh) => {
      const editor = eh.editedByUserId ? userMap.get(Number(eh.editedByUserId)) : undefined;
      return {
        ...eh,
        editedByFullName: eh.editedByFullName ?? editor?.fullName ?? null,
      };
    });

    return {
      id: r.id,
      entityType: r.entityType,
      entityId: r.entityId,
      workflowInstanceId: r.workflowInstanceId,
      parentCommentId: r.parentCommentId,
      content: r.content,
      isInternal: r.isInternal,
      authorUserId: r.authorUserId,
      authorFullName: author?.fullName ?? null,
      authorUsername: author?.username ?? null,
      mentions,
      attachmentFileIds: [...r.attachmentFileIds],
      attachments: [...r.attachments],
      editHistories,
      replies,
      isEdited: r.isEdited,
      isDeleted: r.isDeleted,
      deletedAt: r.deletedAt,
      deletedByUserId: r.deletedByUserId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  };

  const sortedAsc = [...records].sort((a, b) => {
    const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    return diff !== 0 ? diff : a.id - b.id;
  });

  const childrenByParent = new Map<number, StoredWorkflowCommentRecord[]>();
  const recordIds = new Set(sortedAsc.map((r) => r.id));
  const roots: StoredWorkflowCommentRecord[] = [];

  for (const r of sortedAsc) {
    if (r.parentCommentId && recordIds.has(r.parentCommentId)) {
      const list = childrenByParent.get(r.parentCommentId) ?? [];
      list.push(r);
      childrenByParent.set(r.parentCommentId, list);
    } else {
      roots.push(r);
    }
  }

  const buildNode = (r: StoredWorkflowCommentRecord): WorkflowCommentItemView => {
    const childRecords = childrenByParent.get(r.id) ?? [];
    const childViews = childRecords.map(buildNode);
    return toView(r, childViews);
  };

  const rootViews = roots.map(buildNode);
  if (sortOrder === 'DESC') {
    rootViews.reverse();
  }
  return rootViews;
}

export async function executeCreateWorkflowComment(params: {
  dto: CreateWorkflowCommentRequest;
  actor?: UserIdentity | undefined;
  commentsStore: StoredWorkflowCommentRecord[];
  nextCommentId: () => number;
  usersPublicService: IUsersPublicService | null;
  notificationsPublicService: INotificationsPublicService | null;
  filesPublicService: IFilesPublicService | null;
  auditLogService: AuditLogService | null;
}): Promise<WorkflowCommentItemView> {
  const {
    dto,
    actor,
    commentsStore,
    nextCommentId,
    usersPublicService,
    notificationsPublicService,
    filesPublicService,
    auditLogService,
  } = params;

  const normalizedEntityType = dto.entityType.trim().toLowerCase();
  const normalizedEntityId = dto.entityId.trim();

  // 9.5.2: Kiểm tra quyền khi tạo ghi chú nội bộ
  let isInternal = Boolean(dto.isInternal);
  if (isInternal && !canActorAccessInternalNotes(actor)) {
    throw new ForbiddenAppException('workflows.internalNotePermissionDenied');
  }

  // 9.5.3: Kiểm tra bình luận cha khi trả lời bình luận
  let parentCommentId: number | null = null;
  if (dto.parentCommentId !== undefined && dto.parentCommentId !== null) {
    const parent = commentsStore.find((c) => c.id === Number(dto.parentCommentId) && !c.isDeleted);
    if (!parent) {
      throw new NotFoundAppException('workflows.parentCommentNotFound', {
        parentCommentId: dto.parentCommentId,
      });
    }
    if (parent.entityType !== normalizedEntityType || parent.entityId !== normalizedEntityId) {
      throw new BadRequestAppException('workflows.commentEntityMismatch', [
        {
          parentCommentId: parent.id,
          expectedEntityType: parent.entityType,
          expectedEntityId: parent.entityId,
        },
      ]);
    }
    if (parent.isInternal && !canActorAccessInternalNotes(actor)) {
      throw new ForbiddenAppException('workflows.internalNotePermissionDenied');
    }
    if (parent.isInternal) {
      isInternal = true;
    }
    parentCommentId = parent.id;
  }

  const commentId = nextCommentId();
  const authorUserId = actor?.id ?? null;

  // 9.5.4: Bóc tách danh sách nhắc tên (@mention)
  const mentionedUserIds = extractMentionedUserIds(dto.content, dto.mentionedUserIds);

  // 9.5.5: Xác thực & đồng bộ tệp đính kèm qua File Core
  const requestedFileIds = dto.attachmentFileIds ?? [];
  const attachments = await resolveAttachments(requestedFileIds, filesPublicService, {
    commentId,
    actorId: authorUserId,
  });
  const attachmentFileIds = attachments.map((a) => a.fileId);

  const nowIso = new Date().toISOString();
  const record: StoredWorkflowCommentRecord = {
    id: commentId,
    entityType: normalizedEntityType,
    entityId: normalizedEntityId,
    workflowInstanceId: dto.workflowInstanceId ?? null,
    parentCommentId,
    content: dto.content.trim(),
    isInternal,
    authorUserId,
    mentionedUserIds,
    attachmentFileIds,
    attachments,
    editHistories: [],
    isEdited: false,
    isDeleted: false,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  commentsStore.push(record);

  // 9.5.4: Gửi thông báo cho các người dùng được nhắc tên
  if (notificationsPublicService && mentionedUserIds.length > 0) {
    try {
      await notificationsPublicService.dispatch({
        title: isInternal
          ? `Bạn được nhắc tên trong ghi chú nội bộ (${normalizedEntityType}#${normalizedEntityId})`
          : `Bạn được nhắc tên trong bình luận (${normalizedEntityType}#${normalizedEntityId})`,
        content: record.content,
        category: 'SYSTEM',
        priority: 'NORMAL',
        targetType: 'SINGLE_USER',
        userIds: mentionedUserIds,
        referenceModule: WORKFLOWS_AUDIT_META.MODULE,
        referenceType: normalizedEntityType,
        referenceId: normalizedEntityId,
        senderUserId: authorUserId,
        metadata: {
          commentId: record.id,
          parentCommentId: record.parentCommentId,
          isInternal: record.isInternal,
        },
      });
    } catch {
      // Không làm gián đoạn thao tác bình luận nếu dịch vụ thông báo gặp sự cố
    }
  }

  if (auditLogService) {
    await auditLogService.record({
      actor,
      actorUserId: authorUserId,
      module: WORKFLOWS_AUDIT_META.MODULE,
      feature: WORKFLOWS_AUDIT_META.FEATURES.COMMENT,
      action: isInternal ? 'ADD_INTERNAL_NOTE' : 'ADD_COMMENT',
      resourceType: normalizedEntityType,
      resourceId: normalizedEntityId,
      afterData: {
        commentId: record.id,
        parentCommentId: record.parentCommentId,
        isInternal: record.isInternal,
        mentionedUserIds: record.mentionedUserIds,
        attachmentFileIds: record.attachmentFileIds,
      },
    });
  }

  const [hydrated] = await hydrateCommentsTree([record], usersPublicService, 'ASC');
  return hydrated!;
}

function assertCanModifyCommentWithinWindow(params: {
  record: StoredWorkflowCommentRecord;
  actor?: UserIdentity | undefined;
  now?: Date | undefined;
}): void {
  const { record, actor, now = new Date() } = params;
  if (record.isDeleted) {
    throw new BadRequestAppException('workflows.commentAlreadyDeleted', [{ commentId: record.id }]);
  }

  const isManager = canActorManageComments(actor);
  const isAuthor =
    actor?.id !== undefined &&
    record.authorUserId !== null &&
    Number(actor.id) === Number(record.authorUserId);

  if (!isAuthor && !isManager) {
    throw new ForbiddenAppException('workflows.commentPermissionDenied');
  }

  // 9.5.6: Kiểm tra thời hạn chỉnh sửa/xóa đối với tác giả (người có quyền manage được miễn giới hạn thời gian)
  if (!isManager) {
    const editWindowMinutes = Number(
      defaultSettingRegistry.getNumber(
        WORKFLOWS_SETTING_KEYS.COMMENT_EDIT_WINDOW_MINUTES,
        undefined,
        15,
      ),
    );
    const elapsedMs = now.getTime() - new Date(record.createdAt).getTime();
    if (elapsedMs > editWindowMinutes * 60_000) {
      throw new BadRequestAppException('workflows.commentEditWindowExpired', [
        {
          commentId: record.id,
          editWindowMinutes,
        },
      ]);
    }
  }
}

export async function executeUpdateWorkflowComment(params: {
  id: number;
  dto: UpdateWorkflowCommentRequest;
  actor?: UserIdentity | undefined;
  now?: Date | undefined;
  commentsStore: StoredWorkflowCommentRecord[];
  usersPublicService: IUsersPublicService | null;
  notificationsPublicService: INotificationsPublicService | null;
  filesPublicService: IFilesPublicService | null;
  auditLogService: AuditLogService | null;
}): Promise<WorkflowCommentItemView> {
  const {
    id,
    dto,
    actor,
    now = new Date(),
    commentsStore,
    usersPublicService,
    notificationsPublicService,
    filesPublicService,
    auditLogService,
  } = params;

  const record = commentsStore.find((c) => c.id === Number(id));
  if (!record) {
    throw new NotFoundAppException('workflows.commentNotFound', { id });
  }
  if (record.isInternal && !canActorAccessInternalNotes(actor)) {
    throw new ForbiddenAppException('workflows.internalNotePermissionDenied');
  }

  assertCanModifyCommentWithinWindow({ record, actor, now });

  // 9.5.7: Lưu lịch sử chỉnh sửa để không bao giờ mất nội dung cũ
  const nowIso = now.toISOString();
  const previousSnapshot: WorkflowCommentEditHistoryItemView = {
    previousContent: record.content,
    previousAttachmentFileIds: [...record.attachmentFileIds],
    editedByUserId: actor?.id ?? null,
    editedByFullName: null,
    editedAt: nowIso,
    editReason: dto.editReason?.trim() ? dto.editReason.trim() : null,
  };
  record.editHistories.push(previousSnapshot);

  const previousMentions = new Set(record.mentionedUserIds);
  const nextMentions = extractMentionedUserIds(dto.content, dto.mentionedUserIds);
  record.mentionedUserIds = nextMentions;

  if (dto.attachmentFileIds !== undefined) {
    const attachments = await resolveAttachments(dto.attachmentFileIds, filesPublicService, {
      commentId: record.id,
      actorId: actor?.id ?? null,
    });
    record.attachments = attachments;
    record.attachmentFileIds = attachments.map((a) => a.fileId);
  }

  record.content = dto.content.trim();
  record.isEdited = true;
  record.updatedAt = nowIso;

  // Thông báo cho những người mới được nhắc tên trong bản chỉnh sửa
  const newlyMentioned = nextMentions.filter((uid) => !previousMentions.has(uid));
  if (notificationsPublicService && newlyMentioned.length > 0) {
    try {
      await notificationsPublicService.dispatch({
        title: `Bạn được nhắc tên trong bình luận cập nhật (${record.entityType}#${record.entityId})`,
        content: record.content,
        category: 'SYSTEM',
        priority: 'NORMAL',
        targetType: 'SINGLE_USER',
        userIds: newlyMentioned,
        referenceModule: WORKFLOWS_AUDIT_META.MODULE,
        referenceType: record.entityType,
        referenceId: record.entityId,
        senderUserId: actor?.id ?? null,
        metadata: { commentId: record.id, isEdited: true },
      });
    } catch {
      // Ignore notification dispatch failures
    }
  }

  if (auditLogService) {
    await auditLogService.record({
      actor,
      actorUserId: actor?.id ?? null,
      module: WORKFLOWS_AUDIT_META.MODULE,
      feature: WORKFLOWS_AUDIT_META.FEATURES.COMMENT,
      action: 'UPDATE_COMMENT',
      resourceType: record.entityType,
      resourceId: record.entityId,
      beforeData: {
        commentId: record.id,
        content: previousSnapshot.previousContent,
        attachmentFileIds: previousSnapshot.previousAttachmentFileIds,
      },
      afterData: {
        commentId: record.id,
        content: record.content,
        attachmentFileIds: record.attachmentFileIds,
      },
      reason: previousSnapshot.editReason,
    });
  }

  const [hydrated] = await hydrateCommentsTree([record], usersPublicService, 'ASC');
  return hydrated!;
}

export async function executeDeleteWorkflowComment(params: {
  id: number;
  actor?: UserIdentity | undefined;
  now?: Date | undefined;
  commentsStore: StoredWorkflowCommentRecord[];
  usersPublicService: IUsersPublicService | null;
  filesPublicService: IFilesPublicService | null;
  auditLogService: AuditLogService | null;
}): Promise<WorkflowCommentItemView> {
  const {
    id,
    actor,
    now = new Date(),
    commentsStore,
    usersPublicService,
    filesPublicService,
    auditLogService,
  } = params;

  const record = commentsStore.find((c) => c.id === Number(id));
  if (!record) {
    throw new NotFoundAppException('workflows.commentNotFound', { id });
  }
  if (record.isInternal && !canActorAccessInternalNotes(actor)) {
    throw new ForbiddenAppException('workflows.internalNotePermissionDenied');
  }

  assertCanModifyCommentWithinWindow({ record, actor, now });

  const nowIso = now.toISOString();
  record.isDeleted = true;
  record.deletedAt = nowIso;
  record.deletedByUserId = actor?.id ?? null;
  record.updatedAt = nowIso;

  if (filesPublicService && record.attachmentFileIds.length > 0) {
    try {
      await filesPublicService.syncEntityFileUsages({
        moduleName: WORKFLOWS_AUDIT_META.MODULE,
        entityType: WORKFLOWS_AUDIT_META.RESOURCE_TYPES.COMMENT,
        entityId: record.id,
        fieldName: 'attachments',
        fileIds: [],
        actorId: actor?.id ?? null,
      });
    } catch {
      // Ignore detach error on soft delete
    }
  }

  if (auditLogService) {
    await auditLogService.record({
      actor,
      actorUserId: actor?.id ?? null,
      module: WORKFLOWS_AUDIT_META.MODULE,
      feature: WORKFLOWS_AUDIT_META.FEATURES.COMMENT,
      action: 'DELETE_COMMENT',
      resourceType: record.entityType,
      resourceId: record.entityId,
      beforeData: {
        commentId: record.id,
        content: record.content,
      },
    });
  }

  const [hydrated] = await hydrateCommentsTree([record], usersPublicService, 'ASC');
  return hydrated!;
}

export async function executeListWorkflowComments(params: {
  query: ListWorkflowCommentsQuery;
  actor?: UserIdentity | undefined;
  commentsStore: readonly StoredWorkflowCommentRecord[];
  usersPublicService: IUsersPublicService | null;
}): Promise<WorkflowCommentItemView[]> {
  const { query, actor, commentsStore, usersPublicService } = params;
  const normalizedEntityType = query.entityType.trim().toLowerCase();
  const normalizedEntityId = query.entityId.trim();
  const allowInternal = canActorAccessInternalNotes(actor);

  const filtered = commentsStore.filter((c) => {
    if (c.entityType !== normalizedEntityType || c.entityId !== normalizedEntityId) {
      return false;
    }
    if (
      query.workflowInstanceId !== undefined &&
      c.workflowInstanceId !== Number(query.workflowInstanceId)
    ) {
      return false;
    }
    if (!query.includeDeleted && c.isDeleted) {
      return false;
    }
    if (c.isInternal && !allowInternal) {
      return false;
    }
    return true;
  });

  return hydrateCommentsTree(filtered, usersPublicService, query.sortOrder ?? 'ASC');
}

export async function executeBuildRecordActivityTimeline(params: {
  query: ListWorkflowTimelineQuery;
  actor?: UserIdentity | undefined;
  commentsStore: readonly StoredWorkflowCommentRecord[];
  instanceRepository: WorkflowInstanceRepository;
  historyRepository: WorkflowHistoryRepository;
  usersPublicService: IUsersPublicService | null;
  auditLogService: AuditLogService | null;
}): Promise<WorkflowRecordActivityTimelineView> {
  const {
    query,
    actor,
    commentsStore,
    instanceRepository,
    historyRepository,
    usersPublicService,
    auditLogService,
  } = params;

  const normalizedEntityType = query.entityType.trim().toLowerCase();
  const normalizedEntityId = query.entityId.trim();
  const allowInternal = canActorAccessInternalNotes(actor);
  const sourceFilter = query.source ?? 'ALL';

  const entries: WorkflowActivityTimelineEntryView[] = [];
  const userIdsToHydrate = new Set<number>();

  // 1. Nguồn COMMENT & INTERNAL NOTE
  if (sourceFilter === 'ALL' || sourceFilter === 'COMMENT') {
    const matchingComments = commentsStore.filter((c) => {
      if (c.entityType !== normalizedEntityType || c.entityId !== normalizedEntityId) {
        return false;
      }
      if (
        query.workflowInstanceId !== undefined &&
        c.workflowInstanceId !== Number(query.workflowInstanceId)
      ) {
        return false;
      }
      if (c.isDeleted) return false;
      if (c.isInternal && !allowInternal) return false;
      return true;
    });

    for (const c of matchingComments) {
      if (c.authorUserId) userIdsToHydrate.add(Number(c.authorUserId));
      entries.push({
        id: `comment:${c.id}`,
        source: 'COMMENT',
        actionType: c.isInternal
          ? 'INTERNAL_NOTE'
          : c.parentCommentId
            ? 'COMMENT_REPLY'
            : 'COMMENT',
        title: c.isInternal
          ? `Ghi chú nội bộ #${c.id}`
          : c.parentCommentId
            ? `Trả lời bình luận #${c.parentCommentId}`
            : `Bình luận #${c.id}`,
        summary: c.content,
        isInternal: c.isInternal,
        actorUserId: c.authorUserId,
        actorFullName: null,
        actorUsername: null,
        occurredAt: c.createdAt,
        metadata: {
          commentId: c.id,
          parentCommentId: c.parentCommentId,
          workflowInstanceId: c.workflowInstanceId,
          isEdited: c.isEdited,
          editCount: c.editHistories.length,
          mentionedUserIds: c.mentionedUserIds,
          attachmentFileIds: c.attachmentFileIds,
        },
      });
    }
  }

  // 2. Nguồn WORKFLOW HISTORIES
  if (sourceFilter === 'ALL' || sourceFilter === 'WORKFLOW') {
    const instances = await instanceRepository.findByEntity(
      normalizedEntityType,
      normalizedEntityId,
    );
    const targetInstances =
      query.workflowInstanceId !== undefined
        ? instances.filter((i) => Number(i.id) === Number(query.workflowInstanceId))
        : instances;

    for (const inst of targetInstances) {
      const histories = await historyRepository.findByInstanceId(Number(inst.id));
      for (const h of histories) {
        if (h.actorUserId) userIdsToHydrate.add(Number(h.actorUserId));
        const occurredAt =
          h.createdAt instanceof Date ? h.createdAt.toISOString() : String(h.createdAt);
        entries.push({
          id: `workflow:${h.id}`,
          source: 'WORKFLOW',
          actionType: h.actionType,
          title: `Quy trình #${inst.id} (${inst.workflowCode}): ${h.fromStateCode ? `${h.fromStateCode} → ` : ''}${h.toStateCode}`,
          summary: h.reason ?? null,
          isInternal: false,
          actorUserId: h.actorUserId ?? null,
          actorFullName: null,
          actorUsername: null,
          occurredAt,
          metadata: {
            workflowInstanceId: Number(inst.id),
            workflowCode: inst.workflowCode,
            transitionCode: h.transitionCode ?? null,
            fromStateCode: h.fromStateCode ?? null,
            toStateCode: h.toStateCode,
            ...(h.metadataJson ? (safeJsonParseObject(h.metadataJson) ?? {}) : {}),
          },
        });
      }
    }
  }

  // 3. Nguồn AUDIT LOGS
  if ((sourceFilter === 'ALL' || sourceFilter === 'AUDIT') && auditLogService) {
    const auditRes = await auditLogService.listPaginated({
      resourceType: normalizedEntityType,
      resourceId: normalizedEntityId,
      limit: 100,
    });
    for (const log of auditRes.data) {
      if (log.action === 'ADD_INTERNAL_NOTE' && !allowInternal) {
        continue;
      }
      if (log.actorUserId) userIdsToHydrate.add(Number(log.actorUserId));
      entries.push({
        id: `audit:${log.id}`,
        source: 'AUDIT',
        actionType: log.action,
        title: `Audit [${log.module}.${log.feature}]: ${log.action}`,
        summary: log.reason ?? null,
        isInternal: log.action === 'ADD_INTERNAL_NOTE',
        actorUserId: log.actorUserId,
        actorFullName: null,
        actorUsername: log.actorIdentifier ?? null,
        occurredAt: log.createdAt,
        metadata: {
          auditId: log.id,
          module: log.module,
          feature: log.feature,
          beforeData: log.beforeData,
          afterData: log.afterData,
        },
      });
    }
  }

  const userMap = await resolveUserDisplayMap([...userIdsToHydrate], usersPublicService);

  const hydratedEntries: WorkflowActivityTimelineEntryView[] = entries.map((entry) => {
    const u = entry.actorUserId ? userMap.get(Number(entry.actorUserId)) : undefined;
    return {
      ...entry,
      actorFullName: u?.fullName ?? entry.actorFullName,
      actorUsername: u?.username ?? entry.actorUsername,
    };
  });

  const dir = (query.sortOrder ?? 'DESC') === 'ASC' ? 1 : -1;
  hydratedEntries.sort((a, b) => {
    const diff = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
    return diff !== 0 ? diff * dir : a.id.localeCompare(b.id) * dir;
  });

  return {
    entityType: normalizedEntityType,
    entityId: normalizedEntityId,
    totalItems: hydratedEntries.length,
    items: hydratedEntries,
  };
}

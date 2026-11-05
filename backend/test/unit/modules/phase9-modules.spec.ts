import { describe, expect, it } from '@jest/globals';
import { OrganizationMembersController } from '@modules/organization-members/controllers/organization-members.controller.js';
import { OrganizationMembersService } from '@modules/organization-members/services/organization-members.service.js';
import type { UsersService } from '@modules/users/services/users.service.js';
import { ApprovalsController } from '@modules/approvals/controllers/approvals.controller.js';
import { ApprovalsService } from '@modules/approvals/services/approvals.service.js';
import type { WorkflowApprovalDelegationEntity } from '@modules/approvals/entities/workflow-approval-delegation.entity.js';
import type { WorkflowApprovalDelegationRepository } from '@modules/approvals/repositories/workflow-approval-delegation.repository.js';
import { CommentsController } from '@modules/comments/controllers/comments.controller.js';
import { CommentsService } from '@modules/comments/services/comments.service.js';
import type { RecordCommentHistoryEntity } from '@modules/comments/entities/record-comment-history.entity.js';
import type { RecordCommentEntity } from '@modules/comments/entities/record-comment.entity.js';
import type { RecordCommentHistoryRepository } from '@modules/comments/repositories/record-comment-history.repository.js';
import type { RecordCommentRepository } from '@modules/comments/repositories/record-comment.repository.js';
import { TemplatesController } from '@modules/templates/controllers/templates.controller.js';
import { TemplatesMapper } from '@modules/templates/mappers/templates.mapper.js';
import type { TemplatesRepository } from '@modules/templates/repositories/templates.repository.js';
import { TemplatesService } from '@modules/templates/services/templates.service.js';

describe('Phase 9 Standalone Modules: organization-members (9.2), approvals (9.4), comments (9.5) & templates (9.6) with DB Persistence', () => {
  it('9.2 — OrganizationMembersModule assigns memberships, transfers units keeping history, configures direct/temporary managers & queries subordinates', async () => {
    let assignedUnits: Array<{
      organizationUnitId: number;
      code: string;
      name: string;
      isPrimary: boolean;
      positionTitle: string | null;
      startDate: string | null;
      endDate: string | null;
    }> = [
      {
        organizationUnitId: 10,
        code: 'DEPT_IT',
        name: 'Phòng CNTT',
        isPrimary: true,
        positionTitle: 'Senior Engineer',
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: null,
      },
    ];
    let managerId: number | null = 2;
    let temporaryManagerId: number | null = null;
    let temporaryManagerFrom: string | null = null;
    let temporaryManagerUntil: string | null = null;

    const fakeUsersService = {
      listPaginated: async () => ({
        data: [
          {
            id: 5,
            username: 'dev01',
            fullName: 'Nguyễn Văn Dev',
            organizationUnits: assignedUnits,
            managerId,
            temporaryManagerId,
            temporaryManagerFrom,
            temporaryManagerUntil,
            effectiveManagerId: temporaryManagerId ?? managerId,
          },
        ],
        meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
      }),
      getById: async (userId: number) => ({
        id: userId,
        username: 'dev01',
        fullName: 'Nguyễn Văn Dev',
        organizationUnits: assignedUnits,
        managerId,
        temporaryManagerId,
        temporaryManagerFrom,
        temporaryManagerUntil,
        effectiveManagerId: temporaryManagerId ?? managerId,
      }),
      assignOrganizations: async (
        userId: number,
        dto: {
          organizationUnits: Array<{
            organizationUnitId: number;
            isPrimary?: boolean;
            positionTitle?: string | null;
            startDate?: string | null;
            endDate?: string | null;
          }>;
        },
      ) => {
        assignedUnits = dto.organizationUnits.map((u) => ({
          organizationUnitId: u.organizationUnitId,
          code: `UNIT_${u.organizationUnitId}`,
          name: `Đơn vị #${u.organizationUnitId}`,
          isPrimary: Boolean(u.isPrimary),
          positionTitle: u.positionTitle ?? null,
          startDate: u.startDate ?? null,
          endDate: u.endDate ?? null,
        }));
        return {
          id: userId,
          username: 'dev01',
          fullName: 'Nguyễn Văn Dev',
          organizationUnits: assignedUnits,
          managerId,
          temporaryManagerId,
          temporaryManagerFrom,
          temporaryManagerUntil,
          effectiveManagerId: temporaryManagerId ?? managerId,
        };
      },
      update: async (
        userId: number,
        dto: {
          managerId?: number | null;
          temporaryManagerId?: number | null;
          temporaryManagerFrom?: string | null;
          temporaryManagerUntil?: string | null;
        },
      ) => {
        if (dto.managerId !== undefined) managerId = dto.managerId;
        if (dto.temporaryManagerId !== undefined) temporaryManagerId = dto.temporaryManagerId;
        if (dto.temporaryManagerFrom !== undefined) temporaryManagerFrom = dto.temporaryManagerFrom;
        if (dto.temporaryManagerUntil !== undefined)
          temporaryManagerUntil = dto.temporaryManagerUntil;
        return {
          id: userId,
          username: 'dev01',
          fullName: 'Nguyễn Văn Dev',
          organizationUnits: assignedUnits,
          managerId,
          temporaryManagerId,
          temporaryManagerFrom,
          temporaryManagerUntil,
          effectiveManagerId: temporaryManagerId ?? managerId,
        };
      },
      getOrganizationHistory: async (userId: number) => [
        {
          id: 1,
          userId,
          organizationUnitId: 20,
          fromOrganizationUnitId: 10,
          actionType: 'TRANSFER' as const,
          isPrimary: true,
          positionTitle: 'Tech Lead',
          startDate: '2026-06-01T00:00:00.000Z',
          endDate: null,
          reason: 'Điều chuyển sang phòng R&D',
          changedBy: 1,
          createdAt: new Date().toISOString(),
        },
      ],
      getSubordinatesOverview: async (userId: number) => ({
        userId,
        managerId: userId,
        directCount: 1,
        temporaryCount: 0,
        indirectCount: 0,
        totalSubordinates: 1,
        subordinates: [],
        approverChain: [],
      }),
    } as unknown as UsersService;

    const service = new OrganizationMembersService(fakeUsersService);
    const controller = new OrganizationMembersController(service);

    const transferred = await controller.transferMember(5, {
      fromOrganizationUnitId: 10,
      toOrganizationUnitId: 20,
      isPrimary: true,
      positionTitle: 'Tech Lead',
      reason: 'Điều chuyển sang phòng R&D',
    });
    expect(transferred.organizationUnits).toHaveLength(1);
    expect(transferred.organizationUnits[0]?.organizationUnitId).toBe(20);
    expect(transferred.organizationUnits[0]?.positionTitle).toBe('Tech Lead');

    const updatedManagers = await controller.updateManagers(5, {
      managerId: 3,
      temporaryManagerId: 4,
      temporaryManagerFrom: '2026-11-01T00:00:00.000Z',
      temporaryManagerUntil: '2026-12-01T00:00:00.000Z',
    });
    expect(updatedManagers.managerId).toBe(3);
    expect(updatedManagers.temporaryManagerId).toBe(4);
    expect(updatedManagers.effectiveManagerId).toBe(4);

    const detail = await controller.getMemberDetail(5);
    expect(detail.history).toHaveLength(1);
    expect(detail.history[0]?.actionType).toBe('TRANSFER');
    expect(detail.subordinatesOverview.totalSubordinates).toBe(1);
  });

  it('9.4 — ApprovalsModule persists workflow_approval_delegations in DB & coordinates multi-step approval decisions', async () => {
    const dbDelegations = new Map<number, WorkflowApprovalDelegationEntity>();
    let seq = 0;

    const fakeDelegationRepo = {
      createRule: async (data: Partial<WorkflowApprovalDelegationEntity>) => {
        const id = ++seq;
        const entity = {
          id,
          fromUserId: Number(data.fromUserId),
          toUserId: Number(data.toUserId),
          effectiveFrom: data.effectiveFrom ?? new Date('2026-11-01T00:00:00.000Z'),
          effectiveUntil: data.effectiveUntil ?? new Date('2026-12-01T00:00:00.000Z'),
          workflowCodesJson: data.workflowCodesJson ?? '[]',
          entityTypesJson: data.entityTypesJson ?? '[]',
          organizationUnitId: data.organizationUnitId ?? null,
          reason: data.reason ?? null,
          isActive: true,
          createdByUserId: data.createdByUserId ?? 1,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        } as WorkflowApprovalDelegationEntity;
        dbDelegations.set(id, entity);
        return entity;
      },
      findAllRules: async () => [...dbDelegations.values()],
      findById: async (id: number) => dbDelegations.get(Number(id)) ?? null,
      saveEntity: async (entity: WorkflowApprovalDelegationEntity) => {
        dbDelegations.set(Number(entity.id), entity);
        return entity;
      },
    } as unknown as WorkflowApprovalDelegationRepository;

    const service = new ApprovalsService(fakeDelegationRepo, null);
    service.registerInstanceApprovalCoordinator({
      getInstanceSteps: async (instanceId) => ({
        instanceId,
        workflowCode: 'LEAVE_APPROVAL',
        currentStateCode: 'PENDING_MANAGER',
        currentStepOrder: 1,
        status: 1,
        statusName: 'RUNNING',
        approvalSteps: [
          {
            id: 101,
            workflowInstanceId: instanceId,
            stateCode: 'PENDING_MANAGER',
            stepOrder: 1,
            approvalMode: 'SEQUENTIAL',
            approverUserId: 10,
            delegatedFromUserId: null,
            approverRoleCode: null,
            decision: 'PENDING',
            comment: null,
            decidedAt: null,
            decidedByUserId: null,
            createdAt: new Date().toISOString(),
          },
        ],
      }),
      decideStep: async (instanceId, input) => ({
        instanceId,
        decision: input.decision,
        comment: input.comment ?? null,
      }),
    });

    const controller = new ApprovalsController(service);
    const createdRule = await controller.createDelegation(
      {
        fromUserId: 10,
        toUserId: 12,
        effectiveFrom: '2026-11-01T00:00:00.000Z',
        effectiveUntil: '2026-11-15T00:00:00.000Z',
        workflowCodes: ['LEAVE_APPROVAL'],
        entityTypes: ['leave_request'],
        organizationUnitId: 5,
        reason: 'Đi công tác nước ngoài',
      },
      {
        id: 10,
        username: 'manager10',
        roles: ['manager'],
        permissions: ['approvals.delegate'],
        organizationUnitIds: [5],
      },
    );

    expect(createdRule.id).toBe(1);
    expect(dbDelegations.size).toBe(1);
    expect(createdRule.workflowCodes).toEqual(['LEAVE_APPROVAL']);

    const stepsOverview = await controller.getInstanceSteps(99);
    expect(stepsOverview.instanceId).toBe(99);
    expect(stepsOverview.approvalSteps).toHaveLength(1);

    const decisionRes = (await controller.decideInstanceStep(99, {
      decision: 'APPROVE',
      comment: 'Đồng ý phê duyệt',
    })) as { decision: string };
    expect(decisionRes.decision).toBe('APPROVE');

    const revoked = await controller.revokeDelegation(1);
    expect(revoked.revoked).toBe(true);
    expect(dbDelegations.get(1)?.isActive).toBe(false);
  });

  it('9.5 — CommentsModule persists record_comments & record_comment_histories in DB and builds unified activity timeline', async () => {
    const dbComments = new Map<number, RecordCommentEntity>();
    const dbHistories = new Map<number, RecordCommentHistoryEntity>();
    let commentSeq = 0;
    let histSeq = 0;

    const fakeCommentRepo = {
      createComment: async (data: Partial<RecordCommentEntity>) => {
        const id = ++commentSeq;
        const entity = {
          id,
          entityType: data.entityType ?? 'purchase_order',
          entityId: data.entityId ?? 'PO-100',
          workflowInstanceId: data.workflowInstanceId ?? null,
          parentCommentId: data.parentCommentId ?? null,
          content: data.content ?? '',
          isInternal: Boolean(data.isInternal),
          authorUserId: Number(data.authorUserId ?? 1),
          mentionedUserIdsJson: data.mentionedUserIdsJson ?? '[]',
          attachmentFileIdsJson: data.attachmentFileIdsJson ?? '[]',
          isEdited: false,
          isDeleted: false,
          deletedByUserId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        } as RecordCommentEntity;
        dbComments.set(id, entity);
        return entity;
      },
      findByRecordOrInstance: async () => [...dbComments.values()],
      findById: async (id: number) => dbComments.get(Number(id)) ?? null,
      saveEntity: async (entity: RecordCommentEntity) => {
        dbComments.set(Number(entity.id), entity);
        return entity;
      },
    } as unknown as RecordCommentRepository;

    const fakeHistoryRepo = {
      createHistory: async (data: Partial<RecordCommentHistoryEntity>) => {
        const id = ++histSeq;
        const entity = {
          id,
          commentId: Number(data.commentId),
          previousContent: data.previousContent ?? '',
          previousAttachmentFileIdsJson: data.previousAttachmentFileIdsJson ?? '[]',
          editedByUserId: Number(data.editedByUserId ?? 1),
          editReason: data.editReason ?? null,
          editedAt: data.editedAt ?? new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        } as RecordCommentHistoryEntity;
        dbHistories.set(id, entity);
        return entity;
      },
      findByCommentIds: async (commentIds: readonly number[]) =>
        [...dbHistories.values()].filter((h) => commentIds.includes(Number(h.commentId))),
    } as unknown as RecordCommentHistoryRepository;

    const service = new CommentsService(fakeCommentRepo, fakeHistoryRepo);
    service.registerWorkflowTimelineEntriesProvider(async () => [
      {
        id: 'wf_hist_1',
        source: 'WORKFLOW',
        actionType: 'TRANSITION',
        title: 'Chuyển trạng thái DRAFT -> PENDING',
        summary: 'Gửi duyệt đơn mua hàng',
        isInternal: false,
        actorUserId: 1,
        actorFullName: 'Admin',
        actorUsername: 'admin',
        occurredAt: new Date().toISOString(),
        metadata: null,
      },
    ]);

    const controller = new CommentsController(service);
    const rootComment = await controller.createComment({
      entityType: 'purchase_order',
      entityId: 'PO-100',
      workflowInstanceId: 10,
      parentCommentId: null,
      content: 'Đã kiểm tra báo giá cùng @2',
      isInternal: false,
      mentionedUserIds: [2],
      attachmentFileIds: [],
    });

    expect(rootComment.id).toBe(1);
    expect(dbComments.size).toBe(1);

    const edited = await controller.updateComment(1, {
      content: 'Đã kiểm tra báo giá và xác nhận hợp lệ cùng @2',
      editReason: 'Bổ sung xác nhận hợp lệ',
    });
    expect(edited.isEdited).toBe(true);
    expect(edited.editHistories).toHaveLength(1);
    expect(dbHistories.size).toBe(1);

    const timeline = await controller.getRecordTimeline({
      entityType: 'purchase_order',
      entityId: 'PO-100',
    });
    expect(timeline.totalItems).toBeGreaterThanOrEqual(2);
    expect(timeline.items.some((i) => i.source === 'COMMENT')).toBe(true);
    expect(timeline.items.some((i) => i.source === 'WORKFLOW')).toBe(true);
  });

  it('9.6 — TemplatesModule manages Email/Notification/Document templates, preview missing variables, versioning & usage tracking', async () => {
    const fakeTemplatesRepo = {
      findTemplateByCodeChannelLocale: async (code: string, channel: number, locale: string) => ({
        id: 1,
        code,
        name: 'Mẫu thông báo đơn hàng',
        channel,
        templateType: 'NOTIFICATION',
        documentFormat: null,
        category: 2,
        locale,
        version: 2,
        publishedVersion: 2,
        status: 'PUBLISHED',
        subjectTemplate: 'Xin chào {{fullName}}',
        bodyTemplate: 'Đơn hàng #{{orderCode}} đang chờ xử lý tại {{missingBranch}}',
        htmlTemplate: null,
        variablesJson: JSON.stringify(['fullName', 'orderCode', 'missingBranch']),
        isActive: true,
        isSystem: false,
        organizationUnitId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      findTemplateByCodeAndLocale: async (code: string, locale: string) => ({
        id: 2,
        code,
        name: 'Hợp đồng bàn giao',
        channel: 5,
        templateType: 'DOCUMENT',
        documentFormat: 'HTML',
        category: 2,
        locale,
        version: 1,
        publishedVersion: 1,
        status: 'PUBLISHED',
        subjectTemplate: 'Hợp đồng #{{orderCode}}',
        bodyTemplate: 'Hợp đồng #{{orderCode}}',
        htmlTemplate: '<h1>Hợp đồng #{{orderCode}}</h1>',
        variablesJson: JSON.stringify(['orderCode']),
        isActive: true,
        isSystem: true,
        organizationUnitId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    } as unknown as TemplatesRepository;

    const service = new TemplatesService(fakeTemplatesRepo, new TemplatesMapper());
    const controller = new TemplatesController(service);

    const preview = await controller.previewTemplate({
      templateCode: 'ORDER_NOTIFY',
      channel: 1,
      locale: 'vi',
      variables: { fullName: 'Nguyễn Văn A', orderCode: 'ORD-01' },
    });
    expect(preview.missingVariables).toEqual(['missingBranch']);

    const doc = await controller.renderDocument({
      templateCode: 'CONTRACT_DOC',
      locale: 'vi',
      variables: { orderCode: 'ORD-01' },
      outputFormat: 'HTML',
    });
    expect(doc.templateCode).toBe('CONTRACT_DOC');
  });
});

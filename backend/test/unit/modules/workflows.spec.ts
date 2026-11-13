import { BadRequestAppException, ForbiddenAppException } from '@packages/kernel/index.js';
import { AuditLogService } from '@packages/security/index.js';
import {
  WORKFLOW_APPROVAL_DECISION,
  WORKFLOW_APPROVAL_MODE,
  WORKFLOW_DEFINITION_STATUS,
  WORKFLOW_HISTORY_ACTION_TYPE,
  WORKFLOW_INSTANCE_STATUS,
  WORKFLOW_STATE_TYPE,
  WorkflowsService,
  evaluateTransitionConditions,
  executeWorkflowTransitionActions,
} from '../../../src/modules/workflows/index.js';
import type { WorkflowDefinitionEntity } from '../../../src/modules/workflows/entities/workflow-definition.entity.js';
import type { WorkflowStateEntity } from '../../../src/modules/workflows/entities/workflow-state.entity.js';
import type { WorkflowTransitionEntity } from '../../../src/modules/workflows/entities/workflow-transition.entity.js';
import type { WorkflowInstanceEntity } from '../../../src/modules/workflows/entities/workflow-instance.entity.js';
import type { WorkflowApprovalStepEntity } from '../../../src/modules/approvals/entities/workflow-approval-step.entity.js';
import type { WorkflowHistoryEntity } from '../../../src/modules/workflows/entities/workflow-history.entity.js';

describe('Workflows & Approval Module Unit Tests (Sections 9.3 & 9.4)', () => {
  describe('9.3.3 — evaluateTransitionConditions', () => {
    it('allows transition when conditions_json is satisfied', () => {
      const transition = {
        id: 1,
        workflowDefinitionId: 1,
        code: 'SUBMIT',
        name: 'Gửi duyệt',
        fromStateCode: 'DRAFT',
        toStateCode: 'PENDING_APPROVAL',
        conditionsJson: JSON.stringify({
          requiredPermissions: ['workflows.execute'],
          onlyInitiator: true,
          requireReason: true,
          fieldRules: [
            { field: 'totalDays', operator: 'lte', value: 5 },
            { field: 'leaveType', operator: 'in', value: ['ANNUAL', 'SICK'] },
          ],
        }),
        actionsJson: '[]',
        sortOrder: 1,
      } as unknown as WorkflowTransitionEntity;

      const instance = {
        id: 100,
        initiatorUserId: 10,
        currentStateCode: 'DRAFT',
      } as unknown as WorkflowInstanceEntity;

      const result = evaluateTransitionConditions({
        transition,
        instance,
        contextData: { totalDays: 3, leaveType: 'ANNUAL' },
        approvalSteps: [],
        actor: {
          id: 10,
          username: 'emp10',
          roles: ['employee'],
          permissions: ['workflows.execute'],
        },
        reason: 'Xin nghỉ phép năm',
        checkReasonProvided: true,
      });

      expect(result.allowed).toBe(true);
      expect(result.blockedReasons).toHaveLength(0);
    });

    it('blocks transition when reason is missing, permission is lacking, or fieldRule fails', () => {
      const transition = {
        id: 1,
        workflowDefinitionId: 1,
        code: 'SUBMIT',
        name: 'Gửi duyệt',
        fromStateCode: 'DRAFT',
        toStateCode: 'PENDING_APPROVAL',
        conditionsJson: JSON.stringify({
          requiredPermissions: ['workflows.manage'],
          onlyInitiator: true,
          requireReason: true,
          fieldRules: [{ field: 'totalDays', operator: 'lte', value: 5 }],
        }),
        actionsJson: '[]',
        sortOrder: 1,
      } as unknown as WorkflowTransitionEntity;

      const instance = {
        id: 100,
        initiatorUserId: 10,
        currentStateCode: 'DRAFT',
      } as unknown as WorkflowInstanceEntity;

      const result = evaluateTransitionConditions({
        transition,
        instance,
        contextData: { totalDays: 12 },
        approvalSteps: [],
        actor: {
          id: 99,
          username: 'emp99',
          roles: ['employee'],
          permissions: ['workflows.execute'],
        },
        reason: '',
        checkReasonProvided: true,
      });

      expect(result.allowed).toBe(false);
      expect(result.blockedReasons.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('9.3.4 — executeWorkflowTransitionActions', () => {
    it('dispatches RECORD_HISTORY, NOTIFY, and DISPATCH_JOB actions', async () => {
      const sentNotifications: unknown[] = [];
      const publishedJobs: Array<{ topic: string; payload: unknown; queue: unknown }> = [];

      const instance = {
        id: 101,
        workflowDefinitionId: 1,
        workflowCode: 'LEAVE_APPROVAL',
        workflowVersion: 1,
        entityType: 'leave_request',
        entityId: '500',
        title: 'Đơn nghỉ phép 3 ngày',
        currentStateCode: 'APPROVED',
        initiatorUserId: 10,
      } as unknown as WorkflowInstanceEntity;

      const executed = await executeWorkflowTransitionActions({
        instance,
        fromStateCode: 'PENDING_APPROVAL',
        toStateCode: 'APPROVED',
        transitionCode: 'APPROVE',
        actions: [
          { type: 'RECORD_HISTORY' },
          {
            type: 'NOTIFY',
            notifyTargets: ['INITIATOR'],
            title: 'Hồ sơ đã được phê duyệt',
            content: 'Đơn nghỉ phép của bạn đã chuyển sang APPROVED.',
          },
          {
            type: 'DISPATCH_JOB',
            jobTopic: 'workflow.leave.approved',
            jobQueue: 'system.events',
            jobPayload: { source: 'unit-test' },
          },
        ],
        nextApprovalSteps: [],
        actorId: 20,
        reason: 'Đồng ý phê duyệt',
        notificationsPublicService: {
          dispatch: async (input: unknown) => {
            sentNotifications.push(input);
            return { id: 1, recipientCount: 1 };
          },
        } as never,
        messagePublisher: {
          publish: async (topic: string, payload: unknown, queue: unknown) => {
            publishedJobs.push({ topic, payload, queue });
            return { id: 'job-1' };
          },
        } as never,
      });

      expect(executed).toHaveLength(3);
      expect(sentNotifications).toHaveLength(1);
      expect(publishedJobs).toHaveLength(1);
      expect(publishedJobs[0]?.topic).toBe('workflow.leave.approved');
    });
  });

  describe('9.3.1, 9.3.2, 9.3.5, 9.3.6, 9.3.7, 9.3.8 & 9.4 — WorkflowsService Full Lifecycle', () => {
    const createInMemoryWorkflowsService = () => {
      const definitions = new Map<number, WorkflowDefinitionEntity>();
      const states = new Map<number, WorkflowStateEntity>();
      const transitions = new Map<number, WorkflowTransitionEntity>();
      const instances = new Map<number, WorkflowInstanceEntity>();
      const approvalSteps = new Map<number, WorkflowApprovalStepEntity>();
      const histories = new Map<number, WorkflowHistoryEntity>();

      let defSeq = 1;
      let stateSeq = 1;
      let transSeq = 1;
      let instSeq = 1;
      let stepSeq = 1;
      let histSeq = 1;

      const definitionRepo = {
        searchPaginated: async () => ({
          items: Array.from(definitions.values()),
          total: definitions.size,
        }),
        findById: async (id: number) => definitions.get(Number(id)) ?? null,
        findByIds: async (ids: readonly number[]) =>
          Array.from(definitions.values()).filter((d) => ids.includes(Number(d.id))),
        findByCodeAndVersion: async (code: string, version: number) =>
          Array.from(definitions.values()).find(
            (d) => d.code.toUpperCase() === code.toUpperCase() && d.version === version,
          ) ?? null,
        findLatestActiveByCode: async (code: string) =>
          Array.from(definitions.values())
            .filter(
              (d) =>
                d.code.toUpperCase() === code.toUpperCase() &&
                d.status === WORKFLOW_DEFINITION_STATUS.ACTIVE,
            )
            .sort((a, b) => b.version - a.version)[0] ?? null,
        findMaxVersionByCode: async (code: string) => {
          const matching = Array.from(definitions.values()).filter(
            (d) => d.code.toUpperCase() === code.toUpperCase(),
          );
          return matching.length > 0 ? Math.max(...matching.map((m) => m.version)) : 0;
        },
        saveEntity: async (data: Partial<WorkflowDefinitionEntity>) => {
          const id = data.id ? Number(data.id) : defSeq++;
          const entity = {
            id,
            code: data.code ?? 'WF',
            version: data.version ?? 1,
            name: data.name ?? 'Workflow',
            description: data.description ?? null,
            targetEntityType: data.targetEntityType ?? 'leave_request',
            defaultSlaHours: data.defaultSlaHours ?? 24,
            warningBeforeMinutes: data.warningBeforeMinutes ?? 60,
            isSystem: data.isSystem ?? false,
            status: data.status ?? WORKFLOW_DEFINITION_STATUS.ACTIVE,
            createdByUserId: data.createdByUserId ?? 1,
            createdAt: data.createdAt ?? new Date(),
            updatedAt: new Date(),
            deletedAt: null,
          } as WorkflowDefinitionEntity;
          definitions.set(id, entity);
          return entity;
        },
      };

      const stateRepo = {
        findByDefinitionIds: async (definitionIds: readonly number[]) =>
          Array.from(states.values())
            .filter((s) => definitionIds.includes(Number(s.workflowDefinitionId)))
            .sort((a, b) => a.sortOrder - b.sortOrder),
        replaceStatesForDefinition: async (
          definitionId: number,
          items: ReadonlyArray<{
            code: string;
            name: string;
            stateType: string;
            badgeTone?: string;
            slaHours?: number | null;
            approvalConfig?: unknown;
            sortOrder?: number;
          }>,
        ) => {
          for (const [k, v] of states.entries()) {
            if (Number(v.workflowDefinitionId) === Number(definitionId)) {
              states.delete(k);
            }
          }
          const created: WorkflowStateEntity[] = [];
          items.forEach((item, idx) => {
            const id = stateSeq++;
            const entity = {
              id,
              workflowDefinitionId: definitionId,
              code: item.code.toUpperCase(),
              name: item.name,
              stateType: item.stateType,
              badgeTone: item.badgeTone ?? 'neutral',
              slaHours: item.slaHours ?? null,
              approvalConfigJson: item.approvalConfig ? JSON.stringify(item.approvalConfig) : null,
              sortOrder: item.sortOrder ?? idx + 1,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as WorkflowStateEntity;
            states.set(id, entity);
            created.push(entity);
          });
          return created;
        },
      };

      const transitionRepo = {
        findByDefinitionIds: async (definitionIds: readonly number[]) =>
          Array.from(transitions.values())
            .filter((t) => definitionIds.includes(Number(t.workflowDefinitionId)))
            .sort((a, b) => a.sortOrder - b.sortOrder),
        replaceTransitionsForDefinition: async (
          definitionId: number,
          items: ReadonlyArray<{
            code: string;
            name: string;
            fromStateCode: string;
            toStateCode: string;
            conditions?: unknown;
            actions?: unknown;
            sortOrder?: number;
          }>,
        ) => {
          for (const [k, v] of transitions.entries()) {
            if (Number(v.workflowDefinitionId) === Number(definitionId)) {
              transitions.delete(k);
            }
          }
          const created: WorkflowTransitionEntity[] = [];
          items.forEach((item, idx) => {
            const id = transSeq++;
            const entity = {
              id,
              workflowDefinitionId: definitionId,
              code: item.code.toUpperCase(),
              name: item.name,
              fromStateCode: item.fromStateCode.toUpperCase(),
              toStateCode: item.toStateCode.toUpperCase(),
              conditionsJson: JSON.stringify(item.conditions ?? {}),
              actionsJson: JSON.stringify(item.actions ?? []),
              sortOrder: item.sortOrder ?? idx + 1,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as WorkflowTransitionEntity;
            transitions.set(id, entity);
            created.push(entity);
          });
          return created;
        },
      };

      const instanceRepo = {
        searchPaginated: async () => ({
          items: Array.from(instances.values()),
          total: instances.size,
        }),
        findById: async (id: number) => instances.get(Number(id)) ?? null,
        findByEntity: async (entityType: string, entityId: string) =>
          Array.from(instances.values()).filter(
            (i) => i.entityType === entityType.toLowerCase() && i.entityId === entityId,
          ),
        findRunningInstancesWithDueDate: async () =>
          Array.from(instances.values()).filter(
            (i) => i.status === WORKFLOW_INSTANCE_STATUS.RUNNING && i.dueAt !== null,
          ),
        saveEntity: async (data: Partial<WorkflowInstanceEntity>) => {
          const id = data.id ? Number(data.id) : instSeq++;
          const entity = {
            id,
            workflowDefinitionId: data.workflowDefinitionId ?? 1,
            workflowCode: data.workflowCode ?? 'LEAVE_APPROVAL',
            workflowVersion: data.workflowVersion ?? 1,
            entityType: data.entityType ?? 'leave_request',
            entityId: data.entityId ?? '100',
            title: data.title ?? 'Đơn xin nghỉ phép',
            currentStateCode: data.currentStateCode ?? 'DRAFT',
            status: data.status ?? WORKFLOW_INSTANCE_STATUS.RUNNING,
            initiatorUserId: data.initiatorUserId ?? 10,
            organizationUnitId: data.organizationUnitId ?? 1,
            currentStepOrder: data.currentStepOrder ?? 1,
            dueAt: data.dueAt ?? null,
            warningSentAt: data.warningSentAt ?? null,
            overdueNotifiedAt: data.overdueNotifiedAt ?? null,
            isOverdue: data.isOverdue ?? false,
            contextDataJson: data.contextDataJson ?? '{}',
            cancelReason: data.cancelReason ?? null,
            cancelledByUserId: data.cancelledByUserId ?? null,
            completedAt: data.completedAt ?? null,
            createdAt: data.createdAt ?? new Date(),
            updatedAt: new Date(),
          } as WorkflowInstanceEntity;
          instances.set(id, entity);
          return entity;
        },
      };

      const approvalStepRepo = {
        findByInstanceId: async (instanceId: number) =>
          Array.from(approvalSteps.values())
            .filter((s) => Number(s.workflowInstanceId) === Number(instanceId))
            .sort((a, b) => a.stepOrder - b.stepOrder),
        findByInstanceIds: async (instanceIds: readonly number[]) =>
          Array.from(approvalSteps.values()).filter((s) =>
            instanceIds.includes(Number(s.workflowInstanceId)),
          ),
        createSteps: async (items: ReadonlyArray<Partial<WorkflowApprovalStepEntity>>) => {
          const created: WorkflowApprovalStepEntity[] = [];
          for (const item of items) {
            const id = stepSeq++;
            const entity = {
              id,
              workflowInstanceId: item.workflowInstanceId ?? 1,
              stateCode: item.stateCode ?? 'PENDING_MANAGER',
              stepOrder: item.stepOrder ?? 1,
              approvalMode: item.approvalMode ?? WORKFLOW_APPROVAL_MODE.SINGLE,
              approverUserId: item.approverUserId !== undefined ? item.approverUserId : 20,
              approverRoleCode: item.approverRoleCode ?? null,
              delegatedFromUserId: item.delegatedFromUserId ?? null,
              decision: item.decision ?? WORKFLOW_APPROVAL_DECISION.PENDING,
              comment: item.comment ?? null,
              decidedAt: item.decidedAt ?? null,
              decidedByUserId: item.decidedByUserId ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as unknown as WorkflowApprovalStepEntity;
            approvalSteps.set(id, entity);
            created.push(entity);
          }
          return created;
        },
        saveEntity: async (step: WorkflowApprovalStepEntity) => {
          approvalSteps.set(Number(step.id), step);
          return step;
        },
      };

      const historyRepo = {
        findByInstanceId: async (instanceId: number) =>
          Array.from(histories.values())
            .filter((h) => Number(h.workflowInstanceId) === Number(instanceId))
            .sort((a, b) => Number(a.id) - Number(b.id)),
        findByInstanceIds: async (instanceIds: readonly number[]) =>
          Array.from(histories.values())
            .filter((h) => instanceIds.includes(Number(h.workflowInstanceId)))
            .sort((a, b) => Number(a.id) - Number(b.id)),
        recordHistory: async (data: {
          workflowInstanceId: number;
          transitionCode?: string | null;
          actionType: string;
          fromStateCode?: string | null;
          toStateCode: string;
          actorUserId?: number | null;
          reason?: string | null;
          triggeredActions?: unknown;
          metadata?: unknown;
        }) => {
          const id = histSeq++;
          const entity = {
            id,
            workflowInstanceId: data.workflowInstanceId,
            transitionCode: data.transitionCode ?? null,
            actionType: data.actionType,
            fromStateCode: data.fromStateCode ?? null,
            toStateCode: data.toStateCode,
            actorUserId: data.actorUserId ?? null,
            reason: data.reason ?? null,
            triggeredActionsJson: JSON.stringify(data.triggeredActions ?? []),
            metadataJson: data.metadata ? JSON.stringify(data.metadata) : null,
            createdAt: new Date(),
          } as WorkflowHistoryEntity;
          histories.set(id, entity);
          return entity;
        },
      };

      const usersPublicService = {
        findUsersByIds: async (ids: number[]) =>
          ids.map((id) => ({
            id,
            username: `user_${id}`,
            fullName: `Nhân sự #${id}`,
            email: `user${id}@enterprise.vn`,
          })),
        resolveApproverChain: async () => [
          {
            level: 1,
            approverUserId: 20,
            fullName: 'Quản lý trực tiếp #20',
            username: 'manager_20',
            email: 'manager20@enterprise.vn',
            source: 'DIRECT_MANAGER' as const,
          },
        ],
      };

      const dispatchedNotifications: Array<Record<string, unknown>> = [];
      const notificationsPublicService = {
        dispatch: async (input: Record<string, unknown>) => {
          dispatchedNotifications.push(input);
          return { id: dispatchedNotifications.length, recipientCount: 1 };
        },
      };

      const syncedFileUsages: Array<Record<string, unknown>> = [];
      const filesPublicService = {
        ensureActiveFilesExist: async (ids: readonly number[]) =>
          ids.map((fileId) => ({
            id: fileId,
            code: `FILE_${fileId}`,
            displayName: `Tài liệu đính kèm #${fileId}.pdf`,
            originalName: `attachment-${fileId}.pdf`,
            mimeType: 'application/pdf',
            extension: 'pdf',
            category: 4,
            categoryName: 'DOCUMENT',
            sizeBytes: 2048,
            sizeFormatted: '2 KB',
            status: 1,
            statusName: 'ACTIVE',
            visibility: 2,
            visibilityName: 'INTERNAL',
            usageCount: 1,
          })),
        syncEntityFileUsages: async (params: Record<string, unknown>) => {
          syncedFileUsages.push(params);
        },
      };

      const auditLogService = new AuditLogService();

      const service = new WorkflowsService(
        definitionRepo as never,
        stateRepo as never,
        transitionRepo as never,
        instanceRepo as never,
        approvalStepRepo as never,
        historyRepo as never,
        usersPublicService as never,
        notificationsPublicService as never,
        null,
        null,
        null,
        auditLogService,
        filesPublicService as never,
      );

      return {
        service,
        instances,
        approvalSteps,
        histories,
        dispatchedNotifications,
        syncedFileUsages,
        auditLogService,
      };
    };

    it('creates workflow definition, clones new version, starts instance, transitions to approval, delegates & approves step, and records full history', async () => {
      const { service } = createInMemoryWorkflowsService();

      // 9.3.1 & 9.3.2: Tạo quy trình mới kèm trạng thái & bước chuyển
      const created = await service.createDefinition(
        {
          code: 'LEAVE_APPROVAL',
          name: 'Quy trình duyệt nghỉ phép',
          targetEntityType: 'leave_request',
          defaultSlaHours: 24,
          warningBeforeMinutes: 60,
          status: WORKFLOW_DEFINITION_STATUS.ACTIVE,
          states: [
            {
              code: 'DRAFT',
              name: 'Nháp',
              stateType: WORKFLOW_STATE_TYPE.INITIAL,
              badgeTone: 'neutral',
              slaHours: 24,
              approvalConfig: null,
              sortOrder: 1,
            },
            {
              code: 'PENDING_MANAGER',
              name: 'Chờ quản lý duyệt',
              stateType: WORKFLOW_STATE_TYPE.INTERMEDIATE,
              badgeTone: 'warning',
              slaHours: 12,
              approvalConfig: {
                enabled: true,
                mode: WORKFLOW_APPROVAL_MODE.SEQUENTIAL_CHAIN,
                useManagerChain: true,
                maxChainLevels: 1,
                autoTransitionOnApprove: 'APPROVE',
                autoTransitionOnReject: 'REJECT',
              },
              sortOrder: 2,
            },
            {
              code: 'APPROVED',
              name: 'Đã phê duyệt',
              stateType: WORKFLOW_STATE_TYPE.FINAL_APPROVED,
              badgeTone: 'success',
              slaHours: null,
              approvalConfig: null,
              sortOrder: 3,
            },
            {
              code: 'REJECTED',
              name: 'Từ chối',
              stateType: WORKFLOW_STATE_TYPE.FINAL_REJECTED,
              badgeTone: 'danger',
              slaHours: null,
              approvalConfig: null,
              sortOrder: 4,
            },
          ],
          transitions: [
            {
              code: 'SUBMIT',
              name: 'Gửi duyệt',
              fromStateCode: 'DRAFT',
              toStateCode: 'PENDING_MANAGER',
              conditions: { onlyInitiator: true },
              actions: [{ type: 'RECORD_HISTORY' }],
              sortOrder: 1,
            },
            {
              code: 'APPROVE',
              name: 'Phê duyệt',
              fromStateCode: 'PENDING_MANAGER',
              toStateCode: 'APPROVED',
              actions: [{ type: 'NOTIFY', notifyTargets: ['INITIATOR'] }],
              sortOrder: 2,
            },
            {
              code: 'REJECT',
              name: 'Từ chối',
              fromStateCode: 'PENDING_MANAGER',
              toStateCode: 'REJECTED',
              conditions: { requireReason: true },
              sortOrder: 3,
            },
          ],
        },
        1,
      );

      expect(created.code).toBe('LEAVE_APPROVAL');
      expect(created.version).toBe(1);
      expect(created.states).toHaveLength(4);
      expect(created.transitions).toHaveLength(3);

      // Nhân bản phiên bản mới (Version 2)
      const clonedV2 = await service.createNewVersion(created.id, 1);
      expect(clonedV2.version).toBe(2);

      // 9.3.5: Khởi tạo quy trình cho 1 bản ghi nghiệp vụ
      const instance = await service.startWorkflowForEntity(
        {
          workflowCode: 'LEAVE_APPROVAL',
          entityType: 'leave_request',
          entityId: 'LEAVE-2026-99',
          title: 'Xin nghỉ phép 2 ngày',
          contextData: { totalDays: 2 },
        },
        {
          id: 10,
          username: 'emp10',
          permissions: ['workflows.execute'],
          roles: ['employee'],
        },
      );

      expect(instance.currentStateCode).toBe('DRAFT');
      expect(instance.status).toBe(WORKFLOW_INSTANCE_STATUS.RUNNING);
      expect(instance.availableTransitions.map((t) => t.code)).toContain('SUBMIT');

      // 9.3.3 & 9.3.4: Thực thi chuyển trạng thái từ DRAFT -> PENDING_MANAGER
      const afterSubmit = await service.executeTransition(
        instance.id,
        { transitionCode: 'SUBMIT', reason: 'Nộp đơn xin nghỉ phép' },
        {
          id: 10,
          username: 'emp10',
          permissions: ['workflows.execute'],
          roles: ['employee'],
        },
      );

      expect(afterSubmit.currentStateCode).toBe('PENDING_MANAGER');
      expect(afterSubmit.approvalSteps).toHaveLength(1);
      expect(afterSubmit.approvalSteps[0]?.approverUserId).toBe(20);

      // 9.4: Ủy quyền bước duyệt từ Quản lý #20 sang Quản lý #25
      const afterDelegate = await service.delegateApproval(
        instance.id,
        { toUserId: 25, reason: 'Đi công tác' },
        {
          id: 20,
          username: 'mgr20',
          permissions: ['workflows.execute'],
          roles: ['manager'],
        },
      );
      expect(afterDelegate.approvalSteps[0]?.approverUserId).toBe(25);
      expect(afterDelegate.approvalSteps[0]?.delegatedFromUserId).toBe(20);

      // 9.4: Người được ủy quyền #25 thực hiện Phê duyệt -> Tự động chuyển sang APPROVED
      const afterApprove = await service.decideApproval(
        instance.id,
        {
          decision: 'APPROVED',
          comment: 'Đồng ý cho nghỉ phép',
        },
        {
          id: 25,
          username: 'mgr25',
          permissions: ['workflows.execute'],
          roles: ['manager'],
        },
      );

      expect(afterApprove.currentStateCode).toBe('APPROVED');
      expect(afterApprove.status).toBe(WORKFLOW_INSTANCE_STATUS.COMPLETED);

      // 9.3.7: Kiểm tra lịch sử toàn bộ quy trình
      const histories = await service.getInstanceHistories(instance.id);
      expect(histories.length).toBeGreaterThanOrEqual(4);
      expect(histories.map((h) => h.actionType)).toContain(WORKFLOW_HISTORY_ACTION_TYPE.START);
      expect(histories.map((h) => h.actionType)).toContain(WORKFLOW_HISTORY_ACTION_TYPE.DELEGATE);
      expect(histories.map((h) => h.actionType)).toContain(WORKFLOW_HISTORY_ACTION_TYPE.APPROVE);
    });

    it('9.3.6 & 9.3.8 — supports cancelling workflow with reason & scanning SLA overdue instances', async () => {
      const { service, instances } = createInMemoryWorkflowsService();

      await service.createDefinition(
        {
          code: 'EXPENSE_CLAIM',
          name: 'Quy trình thanh toán công tác phí',
          targetEntityType: 'expense_claim',
          defaultSlaHours: 4,
          warningBeforeMinutes: 30,
          status: WORKFLOW_DEFINITION_STATUS.ACTIVE,
        },
        1,
      );

      const started = await service.startWorkflowForEntity(
        {
          workflowCode: 'EXPENSE_CLAIM',
          entityType: 'expense_claim',
          entityId: 'EXP-101',
          title: 'Thanh toán vé máy bay',
        },
        {
          id: 10,
          username: 'emp10',
          permissions: ['workflows.execute'],
          roles: ['employee'],
        },
      );

      // Giả lập quá hạn SLA bằng cách lùi dueAt về quá khứ
      const rawInstance = instances.get(started.id)!;
      rawInstance.dueAt = new Date(Date.now() - 3600_000);

      const slaResult = await service.scanSlaAndNotifyOverdue(new Date());
      expect(slaResult.overdueMarkedCount).toBe(1);
      expect(instances.get(started.id)?.isOverdue).toBe(true);

      // 9.3.6: Hủy quy trình có lý do
      const cancelled = await service.cancelInstance(
        started.id,
        { reason: 'Nhầm số tiền hóa đơn, hủy để tạo lại', action: 'CANCEL' },
        {
          id: 10,
          username: 'emp10',
          permissions: ['workflows.cancel'],
          roles: ['employee'],
        },
      );

      expect(cancelled.status).toBe(WORKFLOW_INSTANCE_STATUS.CANCELLED);
      expect(cancelled.cancelReason).toBe('Nhầm số tiền hóa đơn, hủy để tạo lại');
    });

    it('9.4.1 & 9.4.2 — supports single designated user approval and role-based approval with strict permission checks', async () => {
      const { service } = createInMemoryWorkflowsService();

      await service.createDefinition(
        {
          code: 'ROLE_APPROVAL_WF',
          name: 'Quy trình duyệt theo vai trò Trưởng phòng',
          targetEntityType: 'purchase_order',
          defaultSlaHours: 24,
          warningBeforeMinutes: 60,
          status: WORKFLOW_DEFINITION_STATUS.ACTIVE,
          states: [
            {
              code: 'PENDING_ROLE',
              name: 'Chờ Trưởng phòng duyệt',
              stateType: WORKFLOW_STATE_TYPE.INITIAL,
              badgeTone: 'warning',
              slaHours: 12,
              approvalConfig: {
                enabled: true,
                mode: WORKFLOW_APPROVAL_MODE.SINGLE,
                approverRoleCodes: ['department_head'],
                autoTransitionOnApprove: 'APPROVE',
              },
              sortOrder: 1,
            },
            {
              code: 'APPROVED',
              name: 'Đã duyệt',
              stateType: WORKFLOW_STATE_TYPE.FINAL_APPROVED,
              badgeTone: 'success',
              slaHours: null,
              approvalConfig: null,
              sortOrder: 2,
            },
          ],
          transitions: [
            {
              code: 'APPROVE',
              name: 'Phê duyệt',
              fromStateCode: 'PENDING_ROLE',
              toStateCode: 'APPROVED',
              sortOrder: 1,
            },
          ],
        },
        1,
      );

      const started = await service.startWorkflowForEntity(
        {
          workflowCode: 'ROLE_APPROVAL_WF',
          entityType: 'purchase_order',
          entityId: 'PO-01',
          title: 'Mua thiết bị văn phòng',
        },
        { id: 10, username: 'emp10', roles: ['employee'], permissions: ['workflows.execute'] },
      );

      expect(started.approvalSteps).toHaveLength(1);
      expect(started.approvalSteps[0]?.approverUserId).toBeNull();
      expect(started.approvalSteps[0]?.approverRoleCode).toBe('department_head');

      // Nhân viên không có vai trò department_head bấm duyệt -> bị từ chối
      await expect(
        service.decideApproval(
          started.id,
          { decision: 'APPROVED', comment: 'Cố tình duyệt' },
          { id: 99, username: 'emp99', roles: ['employee'], permissions: ['workflows.execute'] },
        ),
      ).rejects.toThrow();

      // Trưởng phòng (có role department_head) bấm duyệt -> thành công
      const approved = await service.decideApproval(
        started.id,
        { decision: 'APPROVED', comment: 'Trưởng phòng đồng ý' },
        {
          id: 50,
          username: 'head50',
          roles: ['department_head'],
          permissions: ['workflows.execute'],
        },
      );
      expect(approved.status).toBe(WORKFLOW_INSTANCE_STATUS.COMPLETED);
      expect(approved.currentStateCode).toBe('APPROVED');
    });

    it('9.4.3 — enforces sequential multi-step approval (next step only opens after previous step completes)', async () => {
      const { service } = createInMemoryWorkflowsService();

      await service.createDefinition(
        {
          code: 'SEQ_WF',
          name: 'Quy trình duyệt tuần tự 2 bước',
          targetEntityType: 'contract',
          defaultSlaHours: 24,
          warningBeforeMinutes: 60,
          status: WORKFLOW_DEFINITION_STATUS.ACTIVE,
          states: [
            {
              code: 'PENDING_SEQ',
              name: 'Chờ duyệt tuần tự',
              stateType: WORKFLOW_STATE_TYPE.INITIAL,
              badgeTone: 'warning',
              slaHours: 24,
              approvalConfig: {
                enabled: true,
                mode: WORKFLOW_APPROVAL_MODE.SEQUENTIAL_CHAIN,
                approverUserIds: [21, 22],
                autoTransitionOnApprove: 'APPROVE',
              },
              sortOrder: 1,
            },
            {
              code: 'APPROVED',
              name: 'Đã duyệt',
              stateType: WORKFLOW_STATE_TYPE.FINAL_APPROVED,
              badgeTone: 'success',
              slaHours: null,
              approvalConfig: null,
              sortOrder: 2,
            },
          ],
          transitions: [
            {
              code: 'APPROVE',
              name: 'Phê duyệt',
              fromStateCode: 'PENDING_SEQ',
              toStateCode: 'APPROVED',
              sortOrder: 1,
            },
          ],
        },
        1,
      );

      const started = await service.startWorkflowForEntity(
        {
          workflowCode: 'SEQ_WF',
          entityType: 'contract',
          entityId: 'CT-100',
          title: 'Hợp đồng kinh tế',
        },
        { id: 10, username: 'emp10', roles: ['employee'], permissions: ['workflows.execute'] },
      );

      expect(started.currentStepOrder).toBe(1);
      expect(started.approvalSteps).toHaveLength(2);

      // Người duyệt bước 2 (User #22) cố duyệt khi bước 1 chưa xong -> bị chặn
      await expect(
        service.decideApproval(
          started.id,
          { decision: 'APPROVED', comment: 'Duyệt vượt bước' },
          { id: 22, username: 'mgr22', roles: ['manager'], permissions: ['workflows.execute'] },
        ),
      ).rejects.toThrow();

      // Người duyệt bước 1 (User #21) duyệt -> mở bước 2
      const afterStep1 = await service.decideApproval(
        started.id,
        { decision: 'APPROVED', comment: 'Bước 1 đồng ý' },
        { id: 21, username: 'mgr21', roles: ['manager'], permissions: ['workflows.execute'] },
      );
      expect(afterStep1.currentStateCode).toBe('PENDING_SEQ');
      expect(afterStep1.currentStepOrder).toBe(2);

      // Bây giờ người duyệt bước 2 (User #22) duyệt -> hoàn tất chuyển sang APPROVED
      const afterStep2 = await service.decideApproval(
        started.id,
        { decision: 'APPROVED', comment: 'Bước 2 đồng ý' },
        { id: 22, username: 'mgr22', roles: ['manager'], permissions: ['workflows.execute'] },
      );
      expect(afterStep2.currentStateCode).toBe('APPROVED');
      expect(afterStep2.status).toBe(WORKFLOW_INSTANCE_STATUS.COMPLETED);
    });

    it('9.4.4 — supports parallel approval with quorum (minApprovals: 2 of 3 approvers)', async () => {
      const { service } = createInMemoryWorkflowsService();

      await service.createDefinition(
        {
          code: 'QUORUM_WF',
          name: 'Quy trình duyệt song song 2/3 người đồng ý',
          targetEntityType: 'proposal',
          defaultSlaHours: 24,
          warningBeforeMinutes: 60,
          status: WORKFLOW_DEFINITION_STATUS.ACTIVE,
          states: [
            {
              code: 'PENDING_COUNCIL',
              name: 'Hội đồng duyệt song song',
              stateType: WORKFLOW_STATE_TYPE.INITIAL,
              badgeTone: 'warning',
              slaHours: 24,
              approvalConfig: {
                enabled: true,
                mode: WORKFLOW_APPROVAL_MODE.QUORUM,
                minApprovals: 2,
                approverUserIds: [31, 32, 33],
                autoTransitionOnApprove: 'APPROVE',
              },
              sortOrder: 1,
            },
            {
              code: 'APPROVED',
              name: 'Đã duyệt',
              stateType: WORKFLOW_STATE_TYPE.FINAL_APPROVED,
              badgeTone: 'success',
              slaHours: null,
              approvalConfig: null,
              sortOrder: 2,
            },
          ],
          transitions: [
            {
              code: 'APPROVE',
              name: 'Phê duyệt',
              fromStateCode: 'PENDING_COUNCIL',
              toStateCode: 'APPROVED',
              sortOrder: 1,
            },
          ],
        },
        1,
      );

      const started = await service.startWorkflowForEntity(
        {
          workflowCode: 'QUORUM_WF',
          entityType: 'proposal',
          entityId: 'PR-01',
          title: 'Đề xuất ngân sách',
        },
        { id: 10, username: 'emp10', roles: ['employee'], permissions: ['workflows.execute'] },
      );
      expect(started.approvalSteps).toHaveLength(3);

      // Người thứ 1 (#31) đồng ý -> chưa đủ 2/3 nên vẫn ở PENDING_COUNCIL
      const afterFirst = await service.decideApproval(
        started.id,
        { decision: 'APPROVED', comment: 'Thành viên 1 đồng ý' },
        { id: 31, username: 'u31', roles: ['council'], permissions: ['workflows.execute'] },
      );
      expect(afterFirst.currentStateCode).toBe('PENDING_COUNCIL');

      // Người thứ 2 (#32) đồng ý -> đủ 2/3, người thứ 3 (#33) tự động SKIPPED và chuyển sang APPROVED
      const afterSecond = await service.decideApproval(
        started.id,
        { decision: 'APPROVED', comment: 'Thành viên 2 đồng ý' },
        { id: 32, username: 'u32', roles: ['council'], permissions: ['workflows.execute'] },
      );
      expect(afterSecond.currentStateCode).toBe('APPROVED');
      expect(afterSecond.status).toBe(WORKFLOW_INSTANCE_STATUS.COMPLETED);
      const step33 = afterSecond.approvalSteps.find((s) => s.approverUserId === 33);
      expect(step33?.decision).toBe(WORKFLOW_APPROVAL_DECISION.SKIPPED);
    });

    it('9.4.5 & 9.4.6 — requires reason on REJECTED/RETURNED, returns to previous state for creator to edit, and cleans up pending steps', async () => {
      const { service } = createInMemoryWorkflowsService();

      await service.createDefinition(
        {
          code: 'RETURN_REJECT_WF',
          name: 'Quy trình trả lại & từ chối',
          targetEntityType: 'document',
          defaultSlaHours: 24,
          warningBeforeMinutes: 60,
          status: WORKFLOW_DEFINITION_STATUS.ACTIVE,
        },
        1,
      );

      const started = await service.startWorkflowForEntity(
        {
          workflowCode: 'RETURN_REJECT_WF',
          entityType: 'document',
          entityId: 'DOC-01',
          title: 'Tờ trình phê duyệt',
        },
        { id: 10, username: 'emp10', roles: ['employee'], permissions: ['workflows.execute'] },
      );

      const submitted = await service.executeTransition(
        started.id,
        { transitionCode: 'SUBMIT', reason: 'Trình ký lần 1' },
        { id: 10, username: 'emp10', roles: ['employee'], permissions: ['workflows.execute'] },
      );
      expect(submitted.currentStateCode).toBe('PENDING');

      // 9.4.5: Từ chối không nhập lý do -> báo lỗi
      await expect(
        service.decideApproval(
          started.id,
          { decision: 'REJECTED', comment: '   ' },
          { id: 20, username: 'mgr20', roles: ['manager'], permissions: ['workflows.execute'] },
        ),
      ).rejects.toThrow();

      // 9.4.6: Trả lại bước trước (RETURNED) kèm lý do -> quay về DRAFT cho người tạo chỉnh sửa
      const returned = await service.decideApproval(
        started.id,
        { decision: 'RETURNED', comment: 'Bổ sung bảng báo giá chi tiết' },
        { id: 20, username: 'mgr20', roles: ['manager'], permissions: ['workflows.execute'] },
      );
      expect(returned.currentStateCode).toBe('DRAFT');

      // Người tạo chỉnh sửa xong và gửi duyệt lại lần 2 -> vào lại PENDING, từ chối kèm lý do -> REJECTED
      await service.executeTransition(
        started.id,
        { transitionCode: 'SUBMIT', reason: 'Đã bổ sung báo giá lần 2' },
        { id: 10, username: 'emp10', roles: ['employee'], permissions: ['workflows.execute'] },
      );

      const rejected = await service.decideApproval(
        started.id,
        { decision: 'REJECTED', comment: 'Vượt ngân sách quý' },
        { id: 20, username: 'mgr20', roles: ['manager'], permissions: ['workflows.execute'] },
      );
      expect(rejected.currentStateCode).toBe('REJECTED');
      expect(rejected.status).toBe(WORKFLOW_INSTANCE_STATUS.REJECTED);
      expect(
        rejected.histories.some(
          (h) =>
            h.actionType === WORKFLOW_HISTORY_ACTION_TYPE.REJECT &&
            h.reason === 'Vượt ngân sách quý',
        ),
      ).toBe(true);
    });

    it('9.4.7 & 9.4.8 — supports time-and-scope delegation rules and auto-reassigning approver on SLA overdue', async () => {
      const { service, instances } = createInMemoryWorkflowsService();

      // 9.4.7: Tạo quy tắc ủy quyền từ Quản lý #20 sang #28 có thời gian & phạm vi
      const now = Date.now();
      const rule = await service.createDelegationRule(
        {
          fromUserId: 20,
          toUserId: 28,
          effectiveFrom: new Date(now - 3600_000).toISOString(),
          effectiveUntil: new Date(now + 86400_000).toISOString(),
          workflowCodes: ['ESCALATE_WF'],
          entityTypes: ['contract'],
          organizationUnitId: 1,
          reason: 'Ủy quyền trong thời gian công tác nước ngoài',
        },
        { id: 20, username: 'mgr20', roles: ['manager'], permissions: ['workflows.execute'] },
      );
      expect(rule.isActive).toBe(true);

      await service.createDefinition(
        {
          code: 'ESCALATE_WF',
          name: 'Quy trình tự động chuyển người duyệt khi quá hạn',
          targetEntityType: 'contract',
          defaultSlaHours: 8,
          warningBeforeMinutes: 30,
          status: WORKFLOW_DEFINITION_STATUS.ACTIVE,
          states: [
            {
              code: 'PENDING_REVIEW',
              name: 'Chờ duyệt',
              stateType: WORKFLOW_STATE_TYPE.INITIAL,
              badgeTone: 'warning',
              slaHours: 8,
              approvalConfig: {
                enabled: true,
                mode: WORKFLOW_APPROVAL_MODE.SINGLE,
                approverUserIds: [20],
                autoTransitionOnApprove: 'APPROVE',
                autoEscalateOnOverdue: true,
                escalateStrategy: 'SPECIFIC_USER',
                escalateToUserId: 90,
                escalateExtendHours: 12,
              },
              sortOrder: 1,
            },
            {
              code: 'APPROVED',
              name: 'Đã duyệt',
              stateType: WORKFLOW_STATE_TYPE.FINAL_APPROVED,
              badgeTone: 'success',
              slaHours: null,
              approvalConfig: null,
              sortOrder: 2,
            },
          ],
          transitions: [
            {
              code: 'APPROVE',
              name: 'Phê duyệt',
              fromStateCode: 'PENDING_REVIEW',
              toStateCode: 'APPROVED',
              sortOrder: 1,
            },
          ],
        },
        1,
      );

      // Khi khởi tạo trong thời gian & phạm vi ủy quyền, step tự động gán cho #28 (delegatedFromUserId = 20)
      const started = await service.startWorkflowForEntity(
        {
          workflowCode: 'ESCALATE_WF',
          entityType: 'contract',
          entityId: 'CT-999',
          title: 'Hợp đồng thiết bị',
          organizationUnitId: 1,
        },
        { id: 10, username: 'emp10', roles: ['employee'], permissions: ['workflows.execute'] },
      );
      expect(started.approvalSteps[0]?.approverUserId).toBe(28);
      expect(started.approvalSteps[0]?.delegatedFromUserId).toBe(20);

      // 9.4.8: Giả lập quá hạn SLA -> Tự động chuyển người duyệt sang escalateToUserId = 90
      const rawInstance = instances.get(started.id)!;
      rawInstance.dueAt = new Date(Date.now() - 3600_000);

      const scanRes = await service.scanSlaAndNotifyOverdue(new Date());
      expect(scanRes.overdueMarkedCount).toBe(1);
      expect(scanRes.escalatedCount).toBe(1);
      expect(scanRes.escalatedInstanceIds).toContain(started.id);

      const afterEscalate = await service.getInstanceById(started.id);
      expect(afterEscalate.approvalSteps[0]?.approverUserId).toBe(90);
      expect(afterEscalate.approvalSteps[0]?.delegatedFromUserId).toBe(28);
    });

    it('9.5 — supports record comments, internal notes permission filtering, threaded replies, @mentions notifications, File Core attachments, edit history preservation, time window enforcement, and unified activity timeline', async () => {
      const { service, dispatchedNotifications, syncedFileUsages } =
        createInMemoryWorkflowsService();

      const regularEmployee = {
        id: 10,
        username: 'emp10',
        roles: ['employee'],
        permissions: ['workflows.read', 'workflows.execute'],
      };
      const reviewerWithInternalPerm = {
        id: 20,
        username: 'mgr20',
        roles: ['manager'],
        permissions: ['workflows.read', 'workflows.execute', 'workflows.internal_notes'],
      };
      const workflowAdmin = {
        id: 1,
        username: 'admin1',
        roles: ['admin'],
        permissions: ['workflows.read', 'workflows.manage', 'workflows.internal_notes'],
      };

      // Khởi tạo 1 quy trình cho bản ghi contract#CT-500 để có sự kiện Workflow trên Timeline
      await service.createDefinition(
        {
          code: 'CONTRACT_REVIEW_95',
          name: 'Duyệt hợp đồng Mục 9.5',
          targetEntityType: 'contract',
          defaultSlaHours: 24,
          warningBeforeMinutes: 60,
          status: WORKFLOW_DEFINITION_STATUS.ACTIVE,
          states: [
            {
              code: 'DRAFT',
              name: 'Nháp',
              stateType: WORKFLOW_STATE_TYPE.INITIAL,
              badgeTone: 'info',
              slaHours: 12,
              approvalConfig: null,
              sortOrder: 1,
            },
            {
              code: 'APPROVED',
              name: 'Đã duyệt',
              stateType: WORKFLOW_STATE_TYPE.FINAL_APPROVED,
              badgeTone: 'success',
              slaHours: null,
              approvalConfig: null,
              sortOrder: 2,
            },
          ],
          transitions: [
            {
              code: 'APPROVE_DIRECT',
              name: 'Duyệt ngay',
              fromStateCode: 'DRAFT',
              toStateCode: 'APPROVED',
              sortOrder: 1,
            },
          ],
        },
        1,
      );

      const instance = await service.startWorkflowForEntity(
        {
          workflowCode: 'CONTRACT_REVIEW_95',
          entityType: 'contract',
          entityId: 'CT-500',
          title: 'Hợp đồng cung cấp phần mềm #CT-500',
        },
        regularEmployee,
      );

      // 9.5.1, 9.5.4 & 9.5.5: Thêm bình luận công khai có nhắc tên (@user_25 + mentionedUserIds) và đính kèm File Core
      const rootComment = await service.addRecordComment(
        {
          entityType: 'contract',
          entityId: 'CT-500',
          workflowInstanceId: instance.id,
          content: 'Đã đính kèm bản dự thảo hợp đồng, nhờ @user_25 và @20 kiểm tra giúp.',
          isInternal: false,
          mentionedUserIds: [30],
          attachmentFileIds: [101, 102],
        },
        regularEmployee,
      );

      expect(rootComment.id).toBe(1);
      expect(rootComment.isInternal).toBe(false);
      expect(rootComment.authorUserId).toBe(10);
      expect(rootComment.authorFullName).toBe('Nhân sự #10');
      expect(rootComment.mentions.map((m) => m.userId).sort((a, b) => a - b)).toEqual([20, 25, 30]);
      expect(rootComment.attachmentFileIds).toEqual([101, 102]);
      expect(rootComment.attachments).toHaveLength(2);
      expect(rootComment.attachments[0]?.displayName).toContain('#101');
      expect(syncedFileUsages.length).toBeGreaterThanOrEqual(1);
      expect(dispatchedNotifications.length).toBeGreaterThanOrEqual(1);

      // 9.5.3: Trả lời bình luận (Tạo chuỗi trao đổi)
      const replyComment = await service.addRecordComment(
        {
          entityType: 'contract',
          entityId: 'CT-500',
          workflowInstanceId: instance.id,
          parentCommentId: rootComment.id,
          content: 'Tôi đã nhận được file đính kèm và đang rà soát điều khoản thanh toán.',
          isInternal: false,
        },
        reviewerWithInternalPerm,
      );
      expect(replyComment.parentCommentId).toBe(rootComment.id);

      // 9.5.2: Người dùng không có quyền workflows.internal_notes bị chặn khi tạo ghi chú nội bộ
      await expect(
        service.addRecordComment(
          {
            entityType: 'contract',
            entityId: 'CT-500',
            content: 'Ghi chú nội bộ trái phép',
            isInternal: true,
          },
          regularEmployee,
        ),
      ).rejects.toBeInstanceOf(ForbiddenAppException);

      // 9.5.2: Người có quyền workflows.internal_notes tạo ghi chú nội bộ thành công
      const internalNote = await service.addRecordComment(
        {
          entityType: 'contract',
          entityId: 'CT-500',
          workflowInstanceId: instance.id,
          content: 'Ghi chú nội bộ: Đối tác này cần kiểm tra kỹ hạn mức tín dụng.',
          isInternal: true,
        },
        reviewerWithInternalPerm,
      );
      expect(internalNote.isInternal).toBe(true);

      // 9.5.1, 9.5.2 & 9.5.3: Kiểm tra danh sách bình luận theo quyền
      const visibleToEmployee = await service.listRecordComments(
        { entityType: 'contract', entityId: 'CT-500', sortOrder: 'ASC' },
        regularEmployee,
      );
      // Nhân viên thường chỉ thấy 1 root comment công khai (kèm 1 reply bên trong), không thấy internalNote
      expect(visibleToEmployee).toHaveLength(1);
      expect(visibleToEmployee[0]?.id).toBe(rootComment.id);
      expect(visibleToEmployee[0]?.replies).toHaveLength(1);
      expect(visibleToEmployee[0]?.replies[0]?.id).toBe(replyComment.id);

      const visibleToReviewer = await service.listRecordComments(
        { entityType: 'contract', entityId: 'CT-500', sortOrder: 'ASC' },
        reviewerWithInternalPerm,
      );
      // Người có quyền xem nội bộ thấy cả rootComment và internalNote
      expect(visibleToReviewer).toHaveLength(2);
      expect(visibleToReviewer.some((c) => c.isInternal)).toBe(true);

      // 9.5.6 & 9.5.7: Chỉnh sửa bình luận trong thời hạn -> Lưu lịch sử chỉnh sửa (không mất nội dung cũ)
      const updatedComment = await service.updateRecordComment(
        rootComment.id,
        {
          content: 'Đã cập nhật bản dự thảo hợp đồng v2 (bổ sung phụ lục 01).',
          attachmentFileIds: [101, 103],
          editReason: 'Bổ sung thêm phụ lục 01',
        },
        regularEmployee,
      );
      expect(updatedComment.isEdited).toBe(true);
      expect(updatedComment.content).toContain('bản dự thảo hợp đồng v2');
      expect(updatedComment.attachmentFileIds).toEqual([101, 103]);
      expect(updatedComment.editHistories).toHaveLength(1);
      expect(updatedComment.editHistories[0]?.previousContent).toContain('nhờ @user_25');
      expect(updatedComment.editHistories[0]?.previousAttachmentFileIds).toEqual([101, 102]);
      expect(updatedComment.editHistories[0]?.editReason).toBe('Bổ sung thêm phụ lục 01');

      // 9.5.6: Người khác không phải tác giả (và không có quyền manage) không được sửa bình luận
      await expect(
        service.updateRecordComment(
          rootComment.id,
          { content: 'Sửa trái phép' },
          reviewerWithInternalPerm,
        ),
      ).rejects.toBeInstanceOf(ForbiddenAppException);

      // 9.5.6: Quá thời hạn cho phép (mặc định 60 phút — comments.edit_window_minutes) tác giả không được sửa/xóa
      const futureAfterWindow = new Date(Date.now() + 90 * 60_000);
      await expect(
        service.updateRecordComment(
          rootComment.id,
          { content: 'Sửa khi đã quá hạn 60 phút' },
          regularEmployee,
          futureAfterWindow,
        ),
      ).rejects.toBeInstanceOf(BadRequestAppException);

      await expect(
        service.deleteRecordComment(rootComment.id, regularEmployee, futureAfterWindow),
      ).rejects.toBeInstanceOf(BadRequestAppException);

      // Người có quyền workflows.manage vẫn được phép sửa/xóa ngay cả khi đã qua thời hạn của tác giả
      const adminEdited = await service.updateRecordComment(
        rootComment.id,
        {
          content: 'Đã xác nhận bản dự thảo v2 và khóa nội dung.',
          editReason: 'Admin chuẩn hóa ghi chú',
        },
        workflowAdmin,
        futureAfterWindow,
      );
      expect(adminEdited.editHistories).toHaveLength(2);

      // 9.5.8: Hiển thị dòng thời gian hoạt động hợp nhất (Comment + Workflow + Audit)
      const timelineForReviewer = await service.getRecordActivityTimeline(
        {
          entityType: 'contract',
          entityId: 'CT-500',
          source: 'ALL',
          sortOrder: 'DESC',
        },
        reviewerWithInternalPerm,
      );
      expect(timelineForReviewer.totalItems).toBeGreaterThanOrEqual(4);
      const sources = new Set(timelineForReviewer.items.map((item) => item.source));
      expect(sources.has('COMMENT')).toBe(true);
      expect(sources.has('WORKFLOW')).toBe(true);
      expect(sources.has('AUDIT')).toBe(true);

      // Kiểm tra timeline đối với nhân viên thường: không bị lộ ghi chú nội bộ
      const timelineForEmployee = await service.getRecordActivityTimeline(
        {
          entityType: 'contract',
          entityId: 'CT-500',
          source: 'ALL',
          sortOrder: 'DESC',
        },
        regularEmployee,
      );
      expect(timelineForEmployee.items.some((item) => item.isInternal)).toBe(false);

      // Xóa mềm bình luận trả lời trong thời hạn
      const deletedReply = await service.deleteRecordComment(
        replyComment.id,
        reviewerWithInternalPerm,
      );
      expect(deletedReply.isDeleted).toBe(true);
    });
  });
});

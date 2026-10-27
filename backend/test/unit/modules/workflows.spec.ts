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
import type { WorkflowApprovalStepEntity } from '../../../src/modules/workflows/entities/workflow-approval-step.entity.js';
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
              stepName: item.stepName ?? 'Bước 1',
              approvalMode: item.approvalMode ?? WORKFLOW_APPROVAL_MODE.SINGLE,
              approverUserId: item.approverUserId ?? 20,
              approverRoleCode: item.approverRoleCode ?? null,
              delegatedFromUserId: item.delegatedFromUserId ?? null,
              decision: item.decision ?? WORKFLOW_APPROVAL_DECISION.PENDING,
              comment: item.comment ?? null,
              decidedAt: item.decidedAt ?? null,
              decidedByUserId: item.decidedByUserId ?? null,
              dueAt: item.dueAt ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as WorkflowApprovalStepEntity;
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

      const notificationsPublicService = {
        dispatch: async () => ({ id: 1, recipientCount: 1 }),
      };

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
        null,
      );

      return { service, instances, approvalSteps, histories };
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
        { reason: 'Nhầm số tiền hóa đơn, hủy để tạo lại' },
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
  });
});

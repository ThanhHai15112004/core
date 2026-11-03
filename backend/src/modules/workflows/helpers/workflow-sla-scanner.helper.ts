import {
  type INotificationsPublicService,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_TARGET_TYPE,
} from '@modules/notifications/contracts/index.js';
import type { IUsersPublicService } from '@modules/users/contracts/index.js';
import {
  WORKFLOW_APPROVAL_DECISION,
  WORKFLOW_HISTORY_ACTION_TYPE,
} from '../enum/workflows.enum.js';
import type { WorkflowApprovalStepRepository } from '../repositories/workflow-approval-step.repository.js';
import type { WorkflowDefinitionRepository } from '../repositories/workflow-definition.repository.js';
import type { WorkflowHistoryRepository } from '../repositories/workflow-history.repository.js';
import type { WorkflowInstanceRepository } from '../repositories/workflow-instance.repository.js';
import type { WorkflowStateRepository } from '../repositories/workflow-state.repository.js';
import type { WorkflowSlaScanResultView } from '../types/workflows.types.js';
import { parseStateApprovalConfig } from './workflow-condition-evaluator.helper.js';

export async function executeWorkflowSlaScan(params: {
  now?: Date | undefined;
  definitionRepository: WorkflowDefinitionRepository;
  stateRepository?: WorkflowStateRepository | null | undefined;
  instanceRepository: WorkflowInstanceRepository;
  approvalStepRepository: WorkflowApprovalStepRepository;
  historyRepository: WorkflowHistoryRepository;
  usersPublicService?: IUsersPublicService | null | undefined;
  notificationsPublicService: INotificationsPublicService | null;
  defaultWarningMinutes: number;
}): Promise<WorkflowSlaScanResultView> {
  const {
    now = new Date(),
    definitionRepository,
    stateRepository = null,
    instanceRepository,
    approvalStepRepository,
    historyRepository,
    usersPublicService = null,
    notificationsPublicService,
    defaultWarningMinutes,
  } = params;

  const nowMs = now.getTime();
  const runningInstances = await instanceRepository.findRunningInstancesWithDueDate();
  if (runningInstances.length === 0) {
    return {
      scannedAt: now.toISOString(),
      totalRunningChecked: 0,
      warningsTriggeredCount: 0,
      overdueMarkedCount: 0,
      escalatedCount: 0,
      warningInstanceIds: [],
      overdueInstanceIds: [],
      escalatedInstanceIds: [],
    };
  }

  const defIds = [...new Set(runningInstances.map((i) => Number(i.workflowDefinitionId)))];
  const [definitions, states, allSteps] = await Promise.all([
    definitionRepository.findByIds(defIds),
    stateRepository ? stateRepository.findByDefinitionIds(defIds) : Promise.resolve([]),
    approvalStepRepository.findByInstanceIds(runningInstances.map((i) => Number(i.id))),
  ]);
  const defMap = new Map(definitions.map((d) => [Number(d.id), d]));
  const stateMap = new Map(
    states.map((s) => [`${Number(s.workflowDefinitionId)}:${s.code.toUpperCase()}`, s]),
  );

  const stepsByInstance = new Map<number, typeof allSteps>();
  const pendingApproversByInstance = new Map<number, number[]>();
  for (const step of allSteps) {
    const iid = Number(step.workflowInstanceId);
    const stepList = stepsByInstance.get(iid) ?? [];
    stepList.push(step);
    stepsByInstance.set(iid, stepList);

    if (step.decision === WORKFLOW_APPROVAL_DECISION.PENDING && step.approverUserId) {
      const list = pendingApproversByInstance.get(iid) ?? [];
      if (!list.includes(Number(step.approverUserId))) {
        list.push(Number(step.approverUserId));
      }
      pendingApproversByInstance.set(iid, list);
    }
  }

  const warningInstanceIds: number[] = [];
  const overdueInstanceIds: number[] = [];
  const escalatedInstanceIds: number[] = [];

  for (const instance of runningInstances) {
    if (!instance.dueAt) continue;
    const dueMs = new Date(instance.dueAt).getTime();
    if (Number.isNaN(dueMs)) continue;

    const def = defMap.get(Number(instance.workflowDefinitionId));
    const warningMinutes = def?.warningBeforeMinutes ?? defaultWarningMinutes;
    const warningThresholdMs = dueMs - warningMinutes * 60_000;

    const targetUsers = new Set<number>();
    if (instance.initiatorUserId) {
      targetUsers.add(Number(instance.initiatorUserId));
    }
    for (const approverId of pendingApproversByInstance.get(Number(instance.id)) ?? []) {
      targetUsers.add(approverId);
    }

    if (nowMs >= dueMs && !instance.overdueNotifiedAt) {
      const originalDueIso = new Date(instance.dueAt).toISOString();
      instance.isOverdue = true;
      instance.overdueNotifiedAt = now;

      // 9.4.8: Tự động chuyển người duyệt khi quá hạn theo cấu hình State
      const currentState = stateMap.get(
        `${Number(instance.workflowDefinitionId)}:${instance.currentStateCode.toUpperCase()}`,
      );
      const approvalConfig = parseStateApprovalConfig(currentState?.approvalConfigJson);
      let didEscalate = false;

      if (approvalConfig?.enabled && approvalConfig.autoEscalateOnOverdue) {
        const instSteps = (stepsByInstance.get(Number(instance.id)) ?? []).filter(
          (s) =>
            s.stateCode.toUpperCase() === instance.currentStateCode.toUpperCase() &&
            s.decision === WORKFLOW_APPROVAL_DECISION.PENDING,
        );
        if (instSteps.length > 0) {
          const minStepOrder = Math.min(...instSteps.map((s) => Number(s.stepOrder ?? 1)));
          const activeOrder = instSteps.some(
            (s) => Number(s.stepOrder ?? 1) === Number(instance.currentStepOrder ?? 1),
          )
            ? Number(instance.currentStepOrder ?? 1)
            : minStepOrder;
          const activeSteps = instSteps.filter((s) => Number(s.stepOrder ?? 1) === activeOrder);

          for (const step of activeSteps) {
            const fromUserId =
              step.approverUserId !== null && step.approverUserId !== undefined
                ? Number(step.approverUserId)
                : null;
            let escalatedToUserId: number | null = null;
            let escalatedToRoleCode: string | null = null;

            const strategy =
              approvalConfig.escalateStrategy ??
              (approvalConfig.escalateToUserId
                ? 'SPECIFIC_USER'
                : approvalConfig.escalateToRoleCode
                  ? 'SPECIFIC_ROLE'
                  : 'NEXT_MANAGER');

            if (strategy === 'SPECIFIC_USER' && approvalConfig.escalateToUserId) {
              escalatedToUserId = Number(approvalConfig.escalateToUserId);
            } else if (strategy === 'SPECIFIC_ROLE' && approvalConfig.escalateToRoleCode?.trim()) {
              escalatedToRoleCode = approvalConfig.escalateToRoleCode.trim();
            } else if (fromUserId && usersPublicService?.resolveApproverChain) {
              const chain = await usersPublicService.resolveApproverChain(fromUserId, 1);
              if (chain.length > 0) {
                const mgrId = Number(
                  chain[0]?.userId ?? (chain[0] as { approverUserId?: number }).approverUserId,
                );
                if (Number.isInteger(mgrId) && mgrId > 0) {
                  escalatedToUserId = mgrId;
                }
              }
            }

            if (escalatedToUserId !== null || escalatedToRoleCode !== null) {
              step.delegatedFromUserId = fromUserId;
              step.approverUserId = escalatedToUserId;
              if (escalatedToRoleCode !== null) {
                step.approverRoleCode = escalatedToRoleCode;
              }
              await approvalStepRepository.saveEntity(step);
              didEscalate = true;

              if (escalatedToUserId !== null) {
                targetUsers.add(escalatedToUserId);
              }

              await historyRepository.recordHistory({
                workflowInstanceId: Number(instance.id),
                transitionCode: 'AUTO_ESCALATE',
                actionType: WORKFLOW_HISTORY_ACTION_TYPE.DELEGATE,
                fromStateCode: instance.currentStateCode,
                toStateCode: instance.currentStateCode,
                actorUserId: null,
                reason: `Tự động chuyển người duyệt khi quá hạn SLA (${originalDueIso})`,
                metadata: {
                  autoEscalatedOnOverdue: true,
                  stepId: step.id,
                  delegatedFromUserId: fromUserId,
                  delegatedToUserId: escalatedToUserId,
                  delegatedToRoleCode: escalatedToRoleCode,
                },
              });
            }
          }
        }

        if (
          didEscalate &&
          approvalConfig.escalateExtendHours !== undefined &&
          approvalConfig.escalateExtendHours !== null &&
          Number(approvalConfig.escalateExtendHours) > 0
        ) {
          instance.dueAt = new Date(nowMs + Number(approvalConfig.escalateExtendHours) * 3600_000);
        }
      }

      await instanceRepository.saveEntity(instance);
      overdueInstanceIds.push(Number(instance.id));
      if (didEscalate) {
        escalatedInstanceIds.push(Number(instance.id));
      }

      await historyRepository.recordHistory({
        workflowInstanceId: Number(instance.id),
        actionType: WORKFLOW_HISTORY_ACTION_TYPE.SLA_OVERDUE,
        fromStateCode: instance.currentStateCode,
        toStateCode: instance.currentStateCode,
        actorUserId: null,
        reason: `Quy trình đã quá hạn SLA (${originalDueIso})`,
      });

      if (notificationsPublicService && targetUsers.size > 0) {
        const recipients = [...targetUsers];
        await notificationsPublicService
          .dispatch({
            title: `[QUÁ HẠN SLA] Quy trình ${instance.workflowCode}: ${instance.title}`,
            content: `Hồ sơ "${instance.title}" (${instance.entityType}#${instance.entityId}) tại trạng thái ${instance.currentStateCode} đã quá thời hạn xử lý.`,
            category: NOTIFICATION_CATEGORY.WORK,
            priority: NOTIFICATION_PRIORITY.URGENT,
            targetType:
              recipients.length === 1
                ? NOTIFICATION_TARGET_TYPE.SINGLE_USER
                : NOTIFICATION_TARGET_TYPE.USER_GROUP,
            ...(recipients.length === 1 ? { userId: recipients[0] } : { userIds: recipients }),
            referenceModule: 'workflows',
            referenceType: instance.entityType,
            referenceId: String(instance.id),
            actionUrl: '/workflows',
            organizationUnitId: instance.organizationUnitId ?? null,
          })
          .catch(() => undefined);
      }
      continue;
    }

    if (nowMs >= warningThresholdMs && nowMs < dueMs && !instance.warningSentAt) {
      instance.warningSentAt = now;
      await instanceRepository.saveEntity(instance);
      warningInstanceIds.push(Number(instance.id));

      await historyRepository.recordHistory({
        workflowInstanceId: Number(instance.id),
        actionType: WORKFLOW_HISTORY_ACTION_TYPE.SLA_WARNING,
        fromStateCode: instance.currentStateCode,
        toStateCode: instance.currentStateCode,
        actorUserId: null,
        reason: `Cảnh báo sắp đến hạn SLA (${new Date(instance.dueAt).toISOString()})`,
      });

      if (notificationsPublicService && targetUsers.size > 0) {
        const recipients = [...targetUsers];
        await notificationsPublicService
          .dispatch({
            title: `[SẮP ĐẾN HẠN] Quy trình ${instance.workflowCode}: ${instance.title}`,
            content: `Hồ sơ "${instance.title}" (${instance.entityType}#${instance.entityId}) sắp hết hạn xử lý vào lúc ${new Date(instance.dueAt).toLocaleString('vi-VN')}.`,
            category: NOTIFICATION_CATEGORY.WORK,
            priority: NOTIFICATION_PRIORITY.HIGH,
            targetType:
              recipients.length === 1
                ? NOTIFICATION_TARGET_TYPE.SINGLE_USER
                : NOTIFICATION_TARGET_TYPE.USER_GROUP,
            ...(recipients.length === 1 ? { userId: recipients[0] } : { userIds: recipients }),
            referenceModule: 'workflows',
            referenceType: instance.entityType,
            referenceId: String(instance.id),
            actionUrl: '/workflows',
            organizationUnitId: instance.organizationUnitId ?? null,
          })
          .catch(() => undefined);
      }
    }
  }

  return {
    scannedAt: now.toISOString(),
    totalRunningChecked: runningInstances.length,
    warningsTriggeredCount: warningInstanceIds.length,
    overdueMarkedCount: overdueInstanceIds.length,
    escalatedCount: escalatedInstanceIds.length,
    warningInstanceIds,
    overdueInstanceIds,
    escalatedInstanceIds,
  };
}

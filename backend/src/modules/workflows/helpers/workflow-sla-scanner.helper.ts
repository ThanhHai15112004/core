import {
  type INotificationsPublicService,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_TARGET_TYPE,
} from '@modules/notifications/contracts/index.js';
import {
  WORKFLOW_APPROVAL_DECISION,
  WORKFLOW_HISTORY_ACTION_TYPE,
} from '../enum/workflows.enum.js';
import type { WorkflowApprovalStepRepository } from '../repositories/workflow-approval-step.repository.js';
import type { WorkflowDefinitionRepository } from '../repositories/workflow-definition.repository.js';
import type { WorkflowHistoryRepository } from '../repositories/workflow-history.repository.js';
import type { WorkflowInstanceRepository } from '../repositories/workflow-instance.repository.js';
import type { WorkflowSlaScanResultView } from '../types/workflows.types.js';

export async function executeWorkflowSlaScan(params: {
  now?: Date | undefined;
  definitionRepository: WorkflowDefinitionRepository;
  instanceRepository: WorkflowInstanceRepository;
  approvalStepRepository: WorkflowApprovalStepRepository;
  historyRepository: WorkflowHistoryRepository;
  notificationsPublicService: INotificationsPublicService | null;
  defaultWarningMinutes: number;
}): Promise<WorkflowSlaScanResultView> {
  const {
    now = new Date(),
    definitionRepository,
    instanceRepository,
    approvalStepRepository,
    historyRepository,
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
      warningInstanceIds: [],
      overdueInstanceIds: [],
    };
  }

  const defIds = [...new Set(runningInstances.map((i) => Number(i.workflowDefinitionId)))];
  const definitions = await definitionRepository.findByIds(defIds);
  const defMap = new Map(definitions.map((d) => [Number(d.id), d]));

  const allSteps = await approvalStepRepository.findByInstanceIds(
    runningInstances.map((i) => Number(i.id)),
  );
  const pendingApproversByInstance = new Map<number, number[]>();
  for (const step of allSteps) {
    if (step.decision === WORKFLOW_APPROVAL_DECISION.PENDING && step.approverUserId) {
      const iid = Number(step.workflowInstanceId);
      const list = pendingApproversByInstance.get(iid) ?? [];
      if (!list.includes(Number(step.approverUserId))) {
        list.push(Number(step.approverUserId));
      }
      pendingApproversByInstance.set(iid, list);
    }
  }

  const warningInstanceIds: number[] = [];
  const overdueInstanceIds: number[] = [];

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
      instance.isOverdue = true;
      instance.overdueNotifiedAt = now;
      await instanceRepository.saveEntity(instance);
      overdueInstanceIds.push(Number(instance.id));

      await historyRepository.recordHistory({
        workflowInstanceId: Number(instance.id),
        actionType: WORKFLOW_HISTORY_ACTION_TYPE.SLA_OVERDUE,
        fromStateCode: instance.currentStateCode,
        toStateCode: instance.currentStateCode,
        actorUserId: null,
        reason: `Quy trình đã quá hạn SLA (${new Date(instance.dueAt).toISOString()})`,
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
    warningInstanceIds,
    overdueInstanceIds,
  };
}

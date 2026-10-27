import { BaseMessagePublisherProvider, QUEUES, type QueueName } from '@packages/messaging/index.js';
import {
  type INotificationsPublicService,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_TARGET_TYPE,
} from '@modules/notifications/contracts/index.js';
import type { WorkflowApprovalStepEntity } from '../entities/workflow-approval-step.entity.js';
import type { WorkflowInstanceEntity } from '../entities/workflow-instance.entity.js';
import type {
  WorkflowTransitionActionConfig,
  WorkflowTriggeredActionResult,
} from '../types/workflows.types.js';

export async function executeWorkflowTransitionActions(params: {
  instance: WorkflowInstanceEntity;
  fromStateCode: string | null;
  toStateCode: string;
  transitionCode: string | null;
  actions: readonly WorkflowTransitionActionConfig[];
  nextApprovalSteps: readonly WorkflowApprovalStepEntity[];
  actorId?: number | null | undefined;
  reason?: string | null | undefined;
  notificationsPublicService: INotificationsPublicService | null;
  messagePublisher: BaseMessagePublisherProvider | null;
}): Promise<WorkflowTriggeredActionResult[]> {
  const {
    instance,
    fromStateCode,
    toStateCode,
    transitionCode,
    actions,
    nextApprovalSteps,
    actorId,
    reason,
    notificationsPublicService,
    messagePublisher,
  } = params;

  const results: WorkflowTriggeredActionResult[] = [
    {
      type: 'RECORD_HISTORY',
      status: 'SUCCESS',
      referenceId: instance.id,
      detail: `Recorded state transition ${fromStateCode ?? 'START'} -> ${toStateCode}`,
    },
  ];

  for (const action of actions) {
    if (action.type === 'RECORD_HISTORY') {
      continue;
    }

    if (action.type === 'NOTIFY') {
      if (!notificationsPublicService) {
        results.push({
          type: 'NOTIFY',
          status: 'SKIPPED',
          detail: 'NotificationsPublicService is not available',
        });
        continue;
      }

      try {
        const recipientUserIds = new Set<number>();
        const targets = action.notifyTargets ?? ['INITIATOR', 'NEXT_APPROVERS'];

        if (targets.includes('INITIATOR') && instance.initiatorUserId) {
          recipientUserIds.add(Number(instance.initiatorUserId));
        }
        if (targets.includes('NEXT_APPROVERS')) {
          for (const step of nextApprovalSteps) {
            if (step.approverUserId) {
              recipientUserIds.add(Number(step.approverUserId));
            }
          }
        }
        if (action.targetUserIds) {
          for (const uid of action.targetUserIds) {
            if (Number.isInteger(Number(uid)) && Number(uid) > 0) {
              recipientUserIds.add(Number(uid));
            }
          }
        }

        const title =
          action.title?.trim() ||
          `[Quy trình ${instance.workflowCode}] ${instance.title} → ${toStateCode}`;
        const content =
          action.content?.trim() ||
          `Hồ sơ "${instance.title}" (${instance.entityType}#${instance.entityId}) đã chuyển sang trạng thái ${toStateCode}.${reason ? ` Ghi chú: ${reason}` : ''}`;

        if (recipientUserIds.size > 0) {
          const userIdsArr = [...recipientUserIds];
          const dispatched = await notificationsPublicService.dispatch({
            title,
            content,
            category: NOTIFICATION_CATEGORY.WORK,
            priority: NOTIFICATION_PRIORITY.HIGH,
            targetType:
              userIdsArr.length === 1
                ? NOTIFICATION_TARGET_TYPE.SINGLE_USER
                : NOTIFICATION_TARGET_TYPE.USER_GROUP,
            ...(userIdsArr.length === 1 ? { userId: userIdsArr[0] } : { userIds: userIdsArr }),
            referenceModule: 'workflows',
            referenceType: instance.entityType,
            referenceId: String(instance.id),
            actionUrl: '/workflows',
            senderUserId: actorId ?? null,
            organizationUnitId: instance.organizationUnitId ?? null,
          });
          results.push({
            type: 'NOTIFY',
            status: 'SUCCESS',
            referenceId: dispatched.id,
            detail: `Notified ${userIdsArr.length} user(s)`,
          });
        } else if (action.targetRoleCodes && action.targetRoleCodes.length > 0) {
          const dispatched = await notificationsPublicService.dispatch({
            title,
            content,
            category: NOTIFICATION_CATEGORY.WORK,
            priority: NOTIFICATION_PRIORITY.HIGH,
            targetType: NOTIFICATION_TARGET_TYPE.ROLE,
            roleCodes: action.targetRoleCodes,
            referenceModule: 'workflows',
            referenceType: instance.entityType,
            referenceId: String(instance.id),
            actionUrl: '/workflows',
            senderUserId: actorId ?? null,
            organizationUnitId: instance.organizationUnitId ?? null,
          });
          results.push({
            type: 'NOTIFY',
            status: 'SUCCESS',
            referenceId: dispatched.id,
            detail: `Notified role(s): ${action.targetRoleCodes.join(', ')}`,
          });
        } else {
          results.push({
            type: 'NOTIFY',
            status: 'SKIPPED',
            detail: 'No target recipients resolved for notification action',
          });
        }
      } catch (err) {
        results.push({
          type: 'NOTIFY',
          status: 'FAILED',
          detail: err instanceof Error ? err.message : 'Notification dispatch failed',
        });
      }
      continue;
    }

    if (action.type === 'DISPATCH_JOB') {
      const topic = action.jobTopic?.trim() || 'workflows.transition.job';
      const queue = (action.jobQueue?.trim() || QUEUES.SYSTEM_EVENTS) as QueueName;
      const jobPayload = {
        workflowInstanceId: instance.id,
        workflowCode: instance.workflowCode,
        entityType: instance.entityType,
        entityId: instance.entityId,
        fromStateCode,
        toStateCode,
        transitionCode,
        actorId: actorId ?? null,
        ...(action.jobPayload ?? {}),
      };

      if (!messagePublisher) {
        results.push({
          type: 'DISPATCH_JOB',
          status: 'SUCCESS',
          referenceId: `inline:${topic}:${instance.id}`,
          detail: `Prepared job "${topic}" on queue "${queue}"`,
        });
        continue;
      }

      try {
        const envelope = await messagePublisher.publish(topic, jobPayload, queue);
        results.push({
          type: 'DISPATCH_JOB',
          status: 'SUCCESS',
          referenceId: envelope.id,
          detail: `Enqueued job "${topic}" onto "${queue}"`,
        });
      } catch (err) {
        results.push({
          type: 'DISPATCH_JOB',
          status: 'FAILED',
          detail: err instanceof Error ? err.message : 'Queue job dispatch failed',
        });
      }
    }
  }

  return results;
}

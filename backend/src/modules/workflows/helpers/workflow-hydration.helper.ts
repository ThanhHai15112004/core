import { safeJsonParse, safeJsonParseObject } from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import type {
  IUsersPublicService,
  UserNotificationContactView,
} from '@modules/users/contracts/index.js';
import type { WorkflowApprovalStepEntity } from '../entities/workflow-approval-step.entity.js';
import type { WorkflowDefinitionEntity } from '../entities/workflow-definition.entity.js';
import type { WorkflowHistoryEntity } from '../entities/workflow-history.entity.js';
import type { WorkflowInstanceEntity } from '../entities/workflow-instance.entity.js';
import type { WorkflowStateEntity } from '../entities/workflow-state.entity.js';
import type { WorkflowTransitionEntity } from '../entities/workflow-transition.entity.js';
import {
  getWorkflowDefinitionStatusName,
  getWorkflowInstanceStatusName,
  parseWorkflowDefinitionStatus,
  parseWorkflowInstanceStatus,
} from '../contracts/index.js';
import { WORKFLOW_STATE_TYPE } from '../enum/workflows.enum.js';
import type { UpsertWorkflowStateInput } from '../repositories/workflow-state.repository.js';
import type { UpsertWorkflowTransitionInput } from '../repositories/workflow-transition.repository.js';
import type {
  WorkflowApprovalStepItemView,
  WorkflowDefinitionItemView,
  WorkflowHistoryItemView,
  WorkflowInstanceDetailView,
  WorkflowInstanceItemView,
  WorkflowStateItemView,
  WorkflowTransitionItemView,
  WorkflowTriggeredActionResult,
} from '../types/workflows.types.js';
import {
  computeAvailableTransitions,
  parseInstanceContextData,
  parseStateApprovalConfig,
  parseTransitionActions,
  parseTransitionConditions,
} from './workflow-condition-evaluator.helper.js';

export const DEFAULT_WORKFLOW_STATES: readonly UpsertWorkflowStateInput[] = [
  {
    code: 'DRAFT',
    name: 'Bản nháp (Draft)',
    stateType: WORKFLOW_STATE_TYPE.INITIAL,
    badgeTone: 'neutral',
    slaHours: 24,
    sortOrder: 1,
  },
  {
    code: 'PENDING',
    name: 'Chờ phê duyệt (Pending)',
    stateType: WORKFLOW_STATE_TYPE.INTERMEDIATE,
    badgeTone: 'warning',
    slaHours: 24,
    approvalConfig: {
      enabled: true,
      mode: 'SINGLE',
      useManagerChain: true,
      maxChainLevels: 2,
      autoTransitionOnApprove: 'APPROVE',
      autoTransitionOnReject: 'REJECT',
      autoTransitionOnReturn: 'RETURN',
    },
    sortOrder: 2,
  },
  {
    code: 'APPROVED',
    name: 'Đã phê duyệt (Approved)',
    stateType: WORKFLOW_STATE_TYPE.FINAL_APPROVED,
    badgeTone: 'success',
    slaHours: null,
    sortOrder: 3,
  },
  {
    code: 'REJECTED',
    name: 'Đã từ chối (Rejected)',
    stateType: WORKFLOW_STATE_TYPE.FINAL_REJECTED,
    badgeTone: 'danger',
    slaHours: null,
    sortOrder: 4,
  },
];

export const DEFAULT_WORKFLOW_TRANSITIONS: readonly UpsertWorkflowTransitionInput[] = [
  {
    code: 'SUBMIT',
    name: 'Gửi phê duyệt (Submit)',
    fromStateCode: 'DRAFT',
    toStateCode: 'PENDING',
    conditions: { requireReason: false },
    actions: [
      { type: 'RECORD_HISTORY' },
      { type: 'NOTIFY', notifyTargets: ['NEXT_APPROVERS', 'INITIATOR'] },
    ],
    sortOrder: 1,
  },
  {
    code: 'APPROVE',
    name: 'Phê duyệt (Approve)',
    fromStateCode: 'PENDING',
    toStateCode: 'APPROVED',
    conditions: { requireReason: false },
    actions: [
      { type: 'RECORD_HISTORY' },
      { type: 'NOTIFY', notifyTargets: ['INITIATOR'] },
      { type: 'DISPATCH_JOB', jobTopic: 'workflows.approved.completed' },
    ],
    sortOrder: 2,
  },
  {
    code: 'REJECT',
    name: 'Từ chối (Reject)',
    fromStateCode: 'PENDING',
    toStateCode: 'REJECTED',
    conditions: { requireReason: true },
    actions: [{ type: 'RECORD_HISTORY' }, { type: 'NOTIFY', notifyTargets: ['INITIATOR'] }],
    sortOrder: 3,
  },
  {
    code: 'RETURN',
    name: 'Trả lại chỉnh sửa (Return to Draft)',
    fromStateCode: 'PENDING',
    toStateCode: 'DRAFT',
    conditions: { requireReason: true },
    actions: [{ type: 'RECORD_HISTORY' }, { type: 'NOTIFY', notifyTargets: ['INITIATOR'] }],
    sortOrder: 4,
  },
];

export function mapStateEntityToView(s: WorkflowStateEntity): WorkflowStateItemView {
  return {
    id: Number(s.id),
    workflowDefinitionId: Number(s.workflowDefinitionId),
    code: s.code,
    name: s.name,
    stateType: s.stateType,
    badgeTone: s.badgeTone,
    slaHours: s.slaHours !== undefined && s.slaHours !== null ? Number(s.slaHours) : null,
    approvalConfig: parseStateApprovalConfig(s.approvalConfigJson),
    sortOrder: Number(s.sortOrder),
  };
}

export function mapTransitionEntityToView(t: WorkflowTransitionEntity): WorkflowTransitionItemView {
  return {
    id: Number(t.id),
    workflowDefinitionId: Number(t.workflowDefinitionId),
    code: t.code,
    name: t.name,
    fromStateCode: t.fromStateCode,
    toStateCode: t.toStateCode,
    conditions: parseTransitionConditions(t.conditionsJson),
    actions: parseTransitionActions(t.actionsJson),
    sortOrder: Number(t.sortOrder),
  };
}

export function hydrateWorkflowDefinitionsList(
  definitions: readonly WorkflowDefinitionEntity[],
  states: readonly WorkflowStateEntity[],
  transitions: readonly WorkflowTransitionEntity[],
): WorkflowDefinitionItemView[] {
  const statesByDef = new Map<number, WorkflowStateItemView[]>();
  for (const s of states) {
    const defId = Number(s.workflowDefinitionId);
    const list = statesByDef.get(defId) ?? [];
    list.push(mapStateEntityToView(s));
    statesByDef.set(defId, list);
  }

  const transitionsByDef = new Map<number, WorkflowTransitionItemView[]>();
  for (const t of transitions) {
    const defId = Number(t.workflowDefinitionId);
    const list = transitionsByDef.get(defId) ?? [];
    list.push(mapTransitionEntityToView(t));
    transitionsByDef.set(defId, list);
  }

  return definitions.map((d) => {
    const defId = Number(d.id);
    const statusCode = parseWorkflowDefinitionStatus(d.status);
    return {
      id: defId,
      code: d.code,
      version: Number(d.version),
      name: d.name,
      description: d.description ?? null,
      targetEntityType: d.targetEntityType,
      defaultSlaHours: Number(d.defaultSlaHours),
      warningBeforeMinutes: Number(d.warningBeforeMinutes),
      isSystem: Boolean(d.isSystem),
      status: statusCode,
      statusName: getWorkflowDefinitionStatusName(statusCode),
      createdByUserId:
        d.createdByUserId !== undefined && d.createdByUserId !== null
          ? Number(d.createdByUserId)
          : null,
      states: statesByDef.get(defId) ?? [],
      transitions: transitionsByDef.get(defId) ?? [],
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
    };
  });
}

export async function resolveUserContactsMap(
  userIds: readonly number[],
  usersPublicService: IUsersPublicService | null,
): Promise<Map<number, UserNotificationContactView>> {
  const map = new Map<number, UserNotificationContactView>();
  const uniqueIds = [
    ...new Set(userIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)),
  ];
  if (uniqueIds.length === 0 || !usersPublicService?.findUserContactsByIds) {
    return map;
  }
  const contacts = await usersPublicService.findUserContactsByIds(uniqueIds).catch(() => []);
  for (const c of contacts) {
    map.set(Number(c.id), c);
  }
  return map;
}

export async function hydrateWorkflowInstancesList(params: {
  instances: readonly WorkflowInstanceEntity[];
  definitions: readonly WorkflowDefinitionEntity[];
  states: readonly WorkflowStateEntity[];
  usersPublicService: IUsersPublicService | null;
}): Promise<WorkflowInstanceItemView[]> {
  const { instances, definitions, states, usersPublicService } = params;
  if (instances.length === 0) return [];

  const defMap = new Map(definitions.map((d) => [Number(d.id), d]));
  const stateMap = new Map(
    states.map((s) => [`${Number(s.workflowDefinitionId)}:${s.code.toUpperCase()}`, s]),
  );

  const initiatorIds = instances
    .map((i) => i.initiatorUserId)
    .filter((id): id is number => id !== null && id !== undefined);
  const contactsMap = await resolveUserContactsMap(initiatorIds, usersPublicService);

  return instances.map((i) => {
    const def = defMap.get(Number(i.workflowDefinitionId));
    const st = stateMap.get(
      `${Number(i.workflowDefinitionId)}:${i.currentStateCode.toUpperCase()}`,
    );
    const statusCode = parseWorkflowInstanceStatus(i.status);
    const initiatorContact =
      i.initiatorUserId !== null && i.initiatorUserId !== undefined
        ? contactsMap.get(Number(i.initiatorUserId))
        : undefined;

    return {
      id: Number(i.id),
      workflowDefinitionId: Number(i.workflowDefinitionId),
      workflowCode: i.workflowCode,
      workflowVersion: Number(i.workflowVersion),
      workflowName: def?.name ?? null,
      entityType: i.entityType,
      entityId: i.entityId,
      title: i.title,
      currentStateCode: i.currentStateCode,
      currentStateName: st?.name ?? i.currentStateCode,
      currentStateBadgeTone: st?.badgeTone ?? 'info',
      status: statusCode,
      statusName: getWorkflowInstanceStatusName(statusCode),
      initiatorUserId:
        i.initiatorUserId !== null && i.initiatorUserId !== undefined
          ? Number(i.initiatorUserId)
          : null,
      initiatorFullName: initiatorContact?.fullName ?? null,
      organizationUnitId:
        i.organizationUnitId !== null && i.organizationUnitId !== undefined
          ? Number(i.organizationUnitId)
          : null,
      currentStepOrder: Number(i.currentStepOrder ?? 1),
      dueAt: i.dueAt ? new Date(i.dueAt).toISOString() : null,
      warningSentAt: i.warningSentAt ? new Date(i.warningSentAt).toISOString() : null,
      overdueNotifiedAt: i.overdueNotifiedAt ? new Date(i.overdueNotifiedAt).toISOString() : null,
      isOverdue: Boolean(i.isOverdue),
      contextData: parseInstanceContextData(i.contextDataJson),
      cancelReason: i.cancelReason ?? null,
      cancelledByUserId:
        i.cancelledByUserId !== null && i.cancelledByUserId !== undefined
          ? Number(i.cancelledByUserId)
          : null,
      completedAt: i.completedAt ? new Date(i.completedAt).toISOString() : null,
      version: Number(i.version ?? 1),
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    };
  });
}

export async function hydrateWorkflowInstanceDetail(params: {
  instance: WorkflowInstanceEntity;
  definition: WorkflowDefinitionEntity | null;
  states: readonly WorkflowStateEntity[];
  transitions: readonly WorkflowTransitionEntity[];
  approvalSteps: readonly WorkflowApprovalStepEntity[];
  histories: readonly WorkflowHistoryEntity[];
  usersPublicService: IUsersPublicService | null;
  actor?: UserIdentity | undefined;
}): Promise<WorkflowInstanceDetailView> {
  const {
    instance,
    definition,
    states,
    transitions,
    approvalSteps,
    histories,
    usersPublicService,
    actor,
  } = params;

  const [baseItem] = await hydrateWorkflowInstancesList({
    instances: [instance],
    definitions: definition ? [definition] : [],
    states,
    usersPublicService,
  });

  const userIdsToResolve: number[] = [];
  for (const s of approvalSteps) {
    if (s.approverUserId) userIdsToResolve.push(Number(s.approverUserId));
  }
  for (const h of histories) {
    if (h.actorUserId) userIdsToResolve.push(Number(h.actorUserId));
  }
  const contactsMap = await resolveUserContactsMap(userIdsToResolve, usersPublicService);

  const mappedSteps: WorkflowApprovalStepItemView[] = approvalSteps.map((s) => {
    const contact =
      s.approverUserId !== null && s.approverUserId !== undefined
        ? contactsMap.get(Number(s.approverUserId))
        : undefined;
    return {
      id: Number(s.id),
      workflowInstanceId: Number(s.workflowInstanceId),
      stateCode: s.stateCode,
      stepOrder: Number(s.stepOrder),
      approvalMode: s.approvalMode,
      approverUserId:
        s.approverUserId !== null && s.approverUserId !== undefined
          ? Number(s.approverUserId)
          : null,
      approverFullName: contact?.fullName ?? null,
      approverUsername: contact?.username ?? null,
      delegatedFromUserId:
        s.delegatedFromUserId !== null && s.delegatedFromUserId !== undefined
          ? Number(s.delegatedFromUserId)
          : null,
      approverRoleCode: s.approverRoleCode ?? null,
      decision: s.decision,
      comment: s.comment ?? null,
      decidedAt: s.decidedAt ? new Date(s.decidedAt).toISOString() : null,
      decidedByUserId:
        s.decidedByUserId !== null && s.decidedByUserId !== undefined
          ? Number(s.decidedByUserId)
          : null,
    };
  });

  const mappedHistories: WorkflowHistoryItemView[] = histories.map((h) => {
    const actorContact =
      h.actorUserId !== null && h.actorUserId !== undefined
        ? contactsMap.get(Number(h.actorUserId))
        : undefined;
    return {
      id: Number(h.id),
      workflowInstanceId: Number(h.workflowInstanceId),
      transitionCode: h.transitionCode ?? null,
      actionType: h.actionType,
      fromStateCode: h.fromStateCode ?? null,
      toStateCode: h.toStateCode,
      actorUserId:
        h.actorUserId !== null && h.actorUserId !== undefined ? Number(h.actorUserId) : null,
      actorFullName: actorContact?.fullName ?? null,
      actorUsername: actorContact?.username ?? null,
      reason: h.reason ?? null,
      triggeredActions:
        safeJsonParse<WorkflowTriggeredActionResult[]>(h.triggeredActionsJson, []) ?? [],
      metadata: safeJsonParseObject<Record<string, unknown> | null>(h.metadataJson, null),
      createdAt: h.createdAt.toISOString(),
    };
  });

  const availableTransitions = computeAvailableTransitions({
    transitions,
    instance,
    contextData: baseItem!.contextData,
    approvalSteps,
    actor,
  });

  return {
    ...baseItem!,
    availableTransitions,
    approvalSteps: mappedSteps,
    histories: mappedHistories,
  };
}

import {
  BadRequestAppException,
  ForbiddenAppException,
  NotFoundAppException,
} from '@packages/kernel/index.js';
import type { BaseMessagePublisherProvider } from '@packages/messaging/index.js';
import type { AuditLogService, UserIdentity } from '@packages/security/index.js';
import type { INotificationsPublicService } from '@modules/notifications/contracts/index.js';
import type { IUsersPublicService } from '@modules/users/contracts/index.js';
import {
  type StartWorkflowPublicInput,
  WORKFLOWS_AUDIT_META,
  WORKFLOW_APPROVAL_DECISION,
  WORKFLOW_APPROVAL_MODE,
  WORKFLOW_HISTORY_ACTION_TYPE,
  WORKFLOW_INSTANCE_STATUS,
  WORKFLOW_STATE_TYPE,
  type WorkflowInstanceDetailView,
} from '../contracts/index.js';
import type { WorkflowApprovalStepRepository } from '../repositories/workflow-approval-step.repository.js';
import type { WorkflowDefinitionRepository } from '../repositories/workflow-definition.repository.js';
import type { WorkflowHistoryRepository } from '../repositories/workflow-history.repository.js';
import type { WorkflowInstanceRepository } from '../repositories/workflow-instance.repository.js';
import type { WorkflowStateRepository } from '../repositories/workflow-state.repository.js';
import type { WorkflowTransitionRepository } from '../repositories/workflow-transition.repository.js';
import type {
  CancelWorkflowInstanceRequest,
  DecideWorkflowApprovalRequest,
  DelegateWorkflowApprovalRequest,
  ExecuteWorkflowTransitionRequest,
} from '../requests/workflows.requests.js';
import { executeWorkflowTransitionActions } from './workflow-action-dispatcher.helper.js';
import { generateApprovalStepsForState } from './workflow-approver-resolver.helper.js';
import {
  evaluateTransitionConditions,
  parseInstanceContextData,
  parseStateApprovalConfig,
  parseTransitionActions,
  resolveStateSlaDueDate,
} from './workflow-condition-evaluator.helper.js';

export async function executeStartWorkflowForEntity(params: {
  input: StartWorkflowPublicInput;
  actor?: UserIdentity | undefined;
  definitionRepository: WorkflowDefinitionRepository;
  stateRepository: WorkflowStateRepository;
  instanceRepository: WorkflowInstanceRepository;
  approvalStepRepository: WorkflowApprovalStepRepository;
  historyRepository: WorkflowHistoryRepository;
  usersPublicService: IUsersPublicService | null;
  notificationsPublicService: INotificationsPublicService | null;
  messagePublisher: BaseMessagePublisherProvider | null;
  getInstanceById: (id: number, actor?: UserIdentity) => Promise<WorkflowInstanceDetailView>;
}): Promise<WorkflowInstanceDetailView> {
  const {
    input,
    actor,
    definitionRepository,
    stateRepository,
    instanceRepository,
    approvalStepRepository,
    historyRepository,
    usersPublicService,
    notificationsPublicService,
    messagePublisher,
    getInstanceById,
  } = params;

  const def = await definitionRepository.findLatestActiveByCode(input.workflowCode);
  if (!def) {
    throw new NotFoundAppException('workflows.activeDefinitionNotFound', {
      workflowCode: input.workflowCode,
    });
  }

  const states = await stateRepository.findByDefinitionIds([Number(def.id)]);
  const initialState = states.find((s) => s.stateType === WORKFLOW_STATE_TYPE.INITIAL) ?? states[0];
  if (!initialState) {
    throw new BadRequestAppException('workflows.noInitialStateConfigured', [
      { workflowCode: def.code },
    ]);
  }

  const initiatorUserId = input.initiatorUserId ?? actor?.id ?? null;
  const organizationUnitId = input.organizationUnitId ?? actor?.organizationUnitIds?.[0] ?? null;
  const dueAt = resolveStateSlaDueDate({
    targetState: initialState,
    defaultSlaHours: def.defaultSlaHours,
    dueHoursOverride: input.dueHoursOverride,
  });

  const savedInstance = await instanceRepository.saveEntity({
    workflowDefinitionId: Number(def.id),
    workflowCode: def.code,
    workflowVersion: Number(def.version),
    entityType: input.entityType.trim().toLowerCase(),
    entityId: input.entityId.trim(),
    title: input.title.trim(),
    currentStateCode: initialState.code,
    status: WORKFLOW_INSTANCE_STATUS.RUNNING,
    initiatorUserId,
    organizationUnitId,
    currentStepOrder: 1,
    dueAt,
    warningSentAt: null,
    overdueNotifiedAt: null,
    isOverdue: false,
    contextDataJson: input.contextData ? JSON.stringify(input.contextData) : '{}',
    cancelReason: null,
    cancelledByUserId: null,
    completedAt: null,
  });

  const instanceId = Number(savedInstance.id);
  const createdSteps = await generateApprovalStepsForState({
    workflowInstanceId: instanceId,
    targetState: initialState,
    initiatorUserId,
    approvalStepRepository,
    usersPublicService,
  });

  const triggeredActions = await executeWorkflowTransitionActions({
    instance: savedInstance,
    fromStateCode: null,
    toStateCode: initialState.code,
    transitionCode: 'START',
    actions: [
      { type: 'RECORD_HISTORY' },
      ...(createdSteps.length > 0
        ? [{ type: 'NOTIFY' as const, notifyTargets: ['NEXT_APPROVERS' as const] }]
        : []),
    ],
    nextApprovalSteps: createdSteps,
    actorId: initiatorUserId,
    reason: 'Khởi tạo quy trình xử lý cho bản ghi',
    notificationsPublicService,
    messagePublisher,
  });

  await historyRepository.recordHistory({
    workflowInstanceId: instanceId,
    transitionCode: 'START',
    actionType: WORKFLOW_HISTORY_ACTION_TYPE.START,
    fromStateCode: null,
    toStateCode: initialState.code,
    actorUserId: initiatorUserId,
    reason: 'Khởi tạo quy trình xử lý cho bản ghi',
    triggeredActions,
    metadata: {
      entityType: savedInstance.entityType,
      entityId: savedInstance.entityId,
    },
  });

  return getInstanceById(instanceId, actor);
}

export async function executeWorkflowStateTransition(params: {
  id: number;
  dto: ExecuteWorkflowTransitionRequest;
  actor?: UserIdentity | undefined;
  definitionRepository: WorkflowDefinitionRepository;
  stateRepository: WorkflowStateRepository;
  transitionRepository: WorkflowTransitionRepository;
  instanceRepository: WorkflowInstanceRepository;
  approvalStepRepository: WorkflowApprovalStepRepository;
  historyRepository: WorkflowHistoryRepository;
  usersPublicService: IUsersPublicService | null;
  notificationsPublicService: INotificationsPublicService | null;
  messagePublisher: BaseMessagePublisherProvider | null;
  getInstanceById: (id: number, actor?: UserIdentity) => Promise<WorkflowInstanceDetailView>;
}): Promise<WorkflowInstanceDetailView> {
  const {
    id,
    dto,
    actor,
    definitionRepository,
    stateRepository,
    transitionRepository,
    instanceRepository,
    approvalStepRepository,
    historyRepository,
    usersPublicService,
    notificationsPublicService,
    messagePublisher,
    getInstanceById,
  } = params;

  const instance = await instanceRepository.findById(id);
  if (!instance) {
    throw new NotFoundAppException('workflows.instanceNotFound', { id });
  }
  if (instance.status !== WORKFLOW_INSTANCE_STATUS.RUNNING) {
    throw new BadRequestAppException('workflows.instanceNotRunning', [
      { id, status: instance.status },
    ]);
  }

  const defId = Number(instance.workflowDefinitionId);
  const [def, states, transitions, currentSteps] = await Promise.all([
    definitionRepository.findById(defId),
    stateRepository.findByDefinitionIds([defId]),
    transitionRepository.findByDefinitionIds([defId]),
    approvalStepRepository.findByInstanceId(Number(instance.id)),
  ]);

  const requestedCode = dto.transitionCode.trim().toUpperCase();
  const transition = transitions.find(
    (t) =>
      t.code.toUpperCase() === requestedCode &&
      t.fromStateCode.toUpperCase() === instance.currentStateCode.toUpperCase(),
  );
  if (!transition) {
    throw new BadRequestAppException('workflows.invalidTransitionFromCurrentState', [
      {
        currentStateCode: instance.currentStateCode,
        transitionCode: requestedCode,
      },
    ]);
  }

  const mergedContextData = {
    ...parseInstanceContextData(instance.contextDataJson),
    ...(dto.contextDataPatch ?? {}),
  };

  const evalResult = evaluateTransitionConditions({
    transition,
    instance,
    contextData: mergedContextData,
    approvalSteps: currentSteps,
    actor,
    reason: dto.reason,
    checkReasonProvided: true,
  });
  if (!evalResult.allowed) {
    throw new BadRequestAppException('workflows.transitionConditionNotMet', [
      {
        transitionCode: transition.code,
        blockedReasons: evalResult.blockedReasons,
      },
    ]);
  }

  const fromStateCode = instance.currentStateCode;
  const toStateCode = transition.toStateCode.toUpperCase();
  const targetState = states.find((s) => s.code.toUpperCase() === toStateCode);

  instance.currentStateCode = toStateCode;
  instance.contextDataJson = JSON.stringify(mergedContextData);
  instance.currentStepOrder = 1;

  if (targetState?.stateType === WORKFLOW_STATE_TYPE.FINAL_APPROVED) {
    instance.status = WORKFLOW_INSTANCE_STATUS.COMPLETED;
    instance.completedAt = new Date();
    instance.dueAt = null;
    instance.isOverdue = false;
  } else if (targetState?.stateType === WORKFLOW_STATE_TYPE.FINAL_REJECTED) {
    instance.status = WORKFLOW_INSTANCE_STATUS.REJECTED;
    instance.completedAt = new Date();
    instance.dueAt = null;
    instance.isOverdue = false;
  } else if (targetState?.stateType === WORKFLOW_STATE_TYPE.CANCELLED) {
    instance.status = WORKFLOW_INSTANCE_STATUS.CANCELLED;
    instance.completedAt = new Date();
    instance.dueAt = null;
    instance.isOverdue = false;
  } else {
    instance.dueAt = resolveStateSlaDueDate({
      targetState,
      defaultSlaHours: def?.defaultSlaHours ?? 24,
    });
    instance.warningSentAt = null;
    instance.overdueNotifiedAt = null;
    instance.isOverdue = false;
  }

  await instanceRepository.saveEntity(instance);

  const nextApprovalSteps = await generateApprovalStepsForState({
    workflowInstanceId: Number(instance.id),
    targetState,
    initiatorUserId: instance.initiatorUserId ?? null,
    approvalStepRepository,
    usersPublicService,
  });

  const configuredActions = parseTransitionActions(transition.actionsJson);
  const triggeredActions = await executeWorkflowTransitionActions({
    instance,
    fromStateCode,
    toStateCode,
    transitionCode: transition.code,
    actions: configuredActions.length > 0 ? configuredActions : [{ type: 'RECORD_HISTORY' }],
    nextApprovalSteps,
    actorId: actor?.id ?? null,
    reason: dto.reason ?? null,
    notificationsPublicService,
    messagePublisher,
  });

  await historyRepository.recordHistory({
    workflowInstanceId: Number(instance.id),
    transitionCode: transition.code,
    actionType: WORKFLOW_HISTORY_ACTION_TYPE.TRANSITION,
    fromStateCode,
    toStateCode,
    actorUserId: actor?.id ?? null,
    reason: dto.reason ?? null,
    triggeredActions,
  });

  return getInstanceById(Number(instance.id), actor);
}

export async function executeDecideWorkflowApproval(params: {
  id: number;
  dto: DecideWorkflowApprovalRequest;
  actor?: UserIdentity | undefined;
  stateRepository: WorkflowStateRepository;
  transitionRepository: WorkflowTransitionRepository;
  instanceRepository: WorkflowInstanceRepository;
  approvalStepRepository: WorkflowApprovalStepRepository;
  historyRepository: WorkflowHistoryRepository;
  executeTransition: (
    id: number,
    dto: ExecuteWorkflowTransitionRequest,
    actor?: UserIdentity,
  ) => Promise<WorkflowInstanceDetailView>;
  getInstanceById: (id: number, actor?: UserIdentity) => Promise<WorkflowInstanceDetailView>;
}): Promise<WorkflowInstanceDetailView> {
  const {
    id,
    dto,
    actor,
    stateRepository,
    transitionRepository,
    instanceRepository,
    approvalStepRepository,
    historyRepository,
    executeTransition,
    getInstanceById,
  } = params;

  const instance = await instanceRepository.findById(id);
  if (!instance) {
    throw new NotFoundAppException('workflows.instanceNotFound', { id });
  }
  if (instance.status !== WORKFLOW_INSTANCE_STATUS.RUNNING) {
    throw new BadRequestAppException('workflows.instanceNotRunning', [{ id }]);
  }

  const steps = await approvalStepRepository.findByInstanceId(Number(instance.id));
  const pendingForState = steps.filter(
    (s) =>
      s.stateCode.toUpperCase() === instance.currentStateCode.toUpperCase() &&
      s.decision === WORKFLOW_APPROVAL_DECISION.PENDING,
  );

  const actorId = actor?.id ?? null;
  const isSuperOrAdmin =
    actor?.roles?.includes('super_admin') || actor?.roles?.includes('admin') || false;

  const matchingStep =
    pendingForState.find(
      (s) =>
        actorId !== null &&
        s.approverUserId !== null &&
        Number(s.approverUserId) === Number(actorId),
    ) ?? pendingForState[0];

  if (matchingStep) {
    if (
      matchingStep.approverUserId !== null &&
      actorId !== null &&
      Number(matchingStep.approverUserId) !== Number(actorId) &&
      !isSuperOrAdmin
    ) {
      throw new ForbiddenAppException('workflows.notAssignedApproverForStep', [
        { stepId: matchingStep.id, approverUserId: matchingStep.approverUserId },
      ]);
    }

    matchingStep.decision = dto.decision;
    matchingStep.comment = dto.comment ?? null;
    matchingStep.decidedAt = new Date();
    matchingStep.decidedByUserId = actorId;
    await approvalStepRepository.saveEntity(matchingStep);

    if (
      matchingStep.approvalMode === WORKFLOW_APPROVAL_MODE.ANY &&
      dto.decision === WORKFLOW_APPROVAL_DECISION.APPROVED
    ) {
      for (const other of pendingForState) {
        if (other.id !== matchingStep.id) {
          other.decision = WORKFLOW_APPROVAL_DECISION.SKIPPED;
          other.decidedAt = new Date();
          await approvalStepRepository.saveEntity(other);
        }
      }
    }
  }

  const historyAction =
    dto.decision === 'APPROVED'
      ? WORKFLOW_HISTORY_ACTION_TYPE.APPROVE
      : dto.decision === 'REJECTED'
        ? WORKFLOW_HISTORY_ACTION_TYPE.REJECT
        : WORKFLOW_HISTORY_ACTION_TYPE.RETURN;

  await historyRepository.recordHistory({
    workflowInstanceId: Number(instance.id),
    transitionCode: dto.decision,
    actionType: historyAction,
    fromStateCode: instance.currentStateCode,
    toStateCode: instance.currentStateCode,
    actorUserId: actorId,
    reason: dto.comment ?? `Quyết định phê duyệt: ${dto.decision}`,
  });

  const refreshedSteps = await approvalStepRepository.findByInstanceId(Number(instance.id));
  const remainingPending = refreshedSteps.filter(
    (s) =>
      s.stateCode.toUpperCase() === instance.currentStateCode.toUpperCase() &&
      s.decision === WORKFLOW_APPROVAL_DECISION.PENDING,
  );

  if (dto.decision === 'REJECTED' || dto.decision === 'RETURNED' || remainingPending.length === 0) {
    const defId = Number(instance.workflowDefinitionId);
    const [states, transitions] = await Promise.all([
      stateRepository.findByDefinitionIds([defId]),
      transitionRepository.findByDefinitionIds([defId]),
    ]);
    const currentState = states.find(
      (s) => s.code.toUpperCase() === instance.currentStateCode.toUpperCase(),
    );
    const approvalConfig = parseStateApprovalConfig(currentState?.approvalConfigJson);

    const candidateCode =
      dto.transitionCodeOverride ??
      (dto.decision === 'APPROVED'
        ? (approvalConfig?.autoTransitionOnApprove ?? 'APPROVE')
        : dto.decision === 'REJECTED'
          ? (approvalConfig?.autoTransitionOnReject ?? 'REJECT')
          : (approvalConfig?.autoTransitionOnReturn ?? 'RETURN'));

    const hasMatchingTransition = transitions.some(
      (t) =>
        t.fromStateCode.toUpperCase() === instance.currentStateCode.toUpperCase() &&
        t.code.toUpperCase() === candidateCode.toUpperCase(),
    );

    if (hasMatchingTransition) {
      return executeTransition(
        Number(instance.id),
        {
          transitionCode: candidateCode,
          reason: dto.comment ?? `Auto-transition on ${dto.decision}`,
        },
        actor,
      );
    }
  } else {
    const nextStepOrder = Math.min(...remainingPending.map((s) => Number(s.stepOrder)));
    instance.currentStepOrder = nextStepOrder;
    await instanceRepository.saveEntity(instance);
  }

  return getInstanceById(Number(instance.id), actor);
}

export async function executeDelegateWorkflowApproval(params: {
  id: number;
  dto: DelegateWorkflowApprovalRequest;
  actor?: UserIdentity | undefined;
  instanceRepository: WorkflowInstanceRepository;
  approvalStepRepository: WorkflowApprovalStepRepository;
  historyRepository: WorkflowHistoryRepository;
  getInstanceById: (id: number, actor?: UserIdentity) => Promise<WorkflowInstanceDetailView>;
}): Promise<WorkflowInstanceDetailView> {
  const {
    id,
    dto,
    actor,
    instanceRepository,
    approvalStepRepository,
    historyRepository,
    getInstanceById,
  } = params;

  const instance = await instanceRepository.findById(id);
  if (!instance) {
    throw new NotFoundAppException('workflows.instanceNotFound', { id });
  }
  const steps = await approvalStepRepository.findByInstanceId(Number(instance.id));
  const pendingStep = steps.find(
    (s) =>
      s.stateCode.toUpperCase() === instance.currentStateCode.toUpperCase() &&
      s.decision === WORKFLOW_APPROVAL_DECISION.PENDING,
  );
  if (!pendingStep) {
    throw new BadRequestAppException('workflows.noPendingApprovalStepToDelegate', [{ id }]);
  }

  pendingStep.delegatedFromUserId = pendingStep.approverUserId ?? actor?.id ?? null;
  pendingStep.approverUserId = dto.toUserId;
  await approvalStepRepository.saveEntity(pendingStep);

  await historyRepository.recordHistory({
    workflowInstanceId: Number(instance.id),
    transitionCode: 'DELEGATE',
    actionType: WORKFLOW_HISTORY_ACTION_TYPE.DELEGATE,
    fromStateCode: instance.currentStateCode,
    toStateCode: instance.currentStateCode,
    actorUserId: actor?.id ?? null,
    reason: dto.reason.trim(),
    metadata: {
      delegatedToUserId: dto.toUserId,
      delegatedFromUserId: pendingStep.delegatedFromUserId,
    },
  });

  return getInstanceById(Number(instance.id), actor);
}

export async function executeCancelWorkflowInstance(params: {
  id: number;
  dto: CancelWorkflowInstanceRequest;
  actor?: UserIdentity | undefined;
  instanceRepository: WorkflowInstanceRepository;
  approvalStepRepository: WorkflowApprovalStepRepository;
  historyRepository: WorkflowHistoryRepository;
  auditLogService: AuditLogService | null;
  getInstanceById: (id: number, actor?: UserIdentity) => Promise<WorkflowInstanceDetailView>;
}): Promise<WorkflowInstanceDetailView> {
  const {
    id,
    dto,
    actor,
    instanceRepository,
    approvalStepRepository,
    historyRepository,
    auditLogService,
    getInstanceById,
  } = params;

  const instance = await instanceRepository.findById(id);
  if (!instance) {
    throw new NotFoundAppException('workflows.instanceNotFound', { id });
  }
  if (instance.status !== WORKFLOW_INSTANCE_STATUS.RUNNING) {
    throw new BadRequestAppException('workflows.instanceAlreadyFinished', [
      { id, status: instance.status },
    ]);
  }

  if (actor) {
    const hasCancelPerm =
      actor.permissions?.includes('workflows.cancel') ||
      actor.permissions?.includes('workflows.manage') ||
      actor.roles?.includes('super_admin') ||
      actor.roles?.includes('admin');
    const isInitiator =
      instance.initiatorUserId !== null && Number(instance.initiatorUserId) === Number(actor.id);
    if (!hasCancelPerm && !isInitiator) {
      throw new ForbiddenAppException('workflows.cancelPermissionDenied', [{ id }]);
    }
  }

  const fromStateCode = instance.currentStateCode;
  instance.currentStateCode = 'CANCELLED';
  instance.status = WORKFLOW_INSTANCE_STATUS.CANCELLED;
  instance.cancelReason = dto.reason.trim();
  instance.cancelledByUserId = actor?.id ?? null;
  instance.completedAt = new Date();
  instance.dueAt = null;
  instance.isOverdue = false;
  await instanceRepository.saveEntity(instance);

  const steps = await approvalStepRepository.findByInstanceId(Number(instance.id));
  for (const step of steps) {
    if (step.decision === WORKFLOW_APPROVAL_DECISION.PENDING) {
      step.decision = WORKFLOW_APPROVAL_DECISION.SKIPPED;
      step.decidedAt = new Date();
      await approvalStepRepository.saveEntity(step);
    }
  }

  await historyRepository.recordHistory({
    workflowInstanceId: Number(instance.id),
    transitionCode: dto.action,
    actionType:
      dto.action === 'TERMINATE'
        ? WORKFLOW_HISTORY_ACTION_TYPE.TERMINATE
        : WORKFLOW_HISTORY_ACTION_TYPE.CANCEL,
    fromStateCode,
    toStateCode: 'CANCELLED',
    actorUserId: actor?.id ?? null,
    reason: dto.reason.trim(),
  });

  await auditLogService?.record({
    actorUserId: actor?.id ?? null,
    module: WORKFLOWS_AUDIT_META.MODULE,
    feature: WORKFLOWS_AUDIT_META.FEATURES.INSTANCE,
    action: `workflow.instance.${dto.action.toLowerCase()}`,
    resourceType: WORKFLOWS_AUDIT_META.RESOURCE_TYPES.INSTANCE,
    resourceId: instance.id,
    beforeData: { currentStateCode: fromStateCode, status: WORKFLOW_INSTANCE_STATUS.RUNNING },
    afterData: { currentStateCode: 'CANCELLED', status: WORKFLOW_INSTANCE_STATUS.CANCELLED },
    reason: dto.reason.trim(),
  });

  return getInstanceById(Number(instance.id), actor);
}

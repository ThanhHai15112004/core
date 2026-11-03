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
import {
  findActiveDelegationRuleForApprover,
  generateApprovalStepsForState,
  isDelegationScopeMatched,
} from './workflow-approver-resolver.helper.js';
import {
  evaluateTransitionConditions,
  parseInstanceContextData,
  parseStateApprovalConfig,
  parseTransitionActions,
  resolveStateSlaDueDate,
} from './workflow-condition-evaluator.helper.js';
import type { WorkflowApprovalDelegationRule } from '../types/workflows.types.js';

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
  delegationRules?: readonly WorkflowApprovalDelegationRule[] | undefined;
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
    delegationRules,
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
    delegationRules,
    scopeContext: {
      workflowCode: savedInstance.workflowCode,
      entityType: savedInstance.entityType,
      organizationUnitId: savedInstance.organizationUnitId ?? null,
    },
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
  delegationRules?: readonly WorkflowApprovalDelegationRule[] | undefined;
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
    delegationRules,
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
    delegationRules,
    scopeContext: {
      workflowCode: instance.workflowCode,
      entityType: instance.entityType,
      organizationUnitId: instance.organizationUnitId ?? null,
    },
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
  delegationRules?: readonly WorkflowApprovalDelegationRule[] | undefined;
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
    delegationRules,
    executeTransition,
    getInstanceById,
  } = params;

  if (
    (dto.decision === 'REJECTED' || dto.decision === 'RETURNED') &&
    (!dto.comment || !dto.comment.trim())
  ) {
    throw new BadRequestAppException('workflows.approvalReasonRequired', [
      { decision: dto.decision },
    ]);
  }

  const instance = await instanceRepository.findById(id);
  if (!instance) {
    throw new NotFoundAppException('workflows.instanceNotFound', { id });
  }
  if (instance.status !== WORKFLOW_INSTANCE_STATUS.RUNNING) {
    throw new BadRequestAppException('workflows.instanceNotRunning', [{ id }]);
  }

  const defId = Number(instance.workflowDefinitionId);
  const [states, transitions, steps] = await Promise.all([
    stateRepository.findByDefinitionIds([defId]),
    transitionRepository.findByDefinitionIds([defId]),
    approvalStepRepository.findByInstanceId(Number(instance.id)),
  ]);

  const currentState = states.find(
    (s) => s.code.toUpperCase() === instance.currentStateCode.toUpperCase(),
  );
  const approvalConfig = parseStateApprovalConfig(currentState?.approvalConfigJson);

  const pendingForState = steps.filter(
    (s) =>
      s.stateCode.toUpperCase() === instance.currentStateCode.toUpperCase() &&
      s.decision === WORKFLOW_APPROVAL_DECISION.PENDING,
  );

  const actorId = actor?.id ?? null;
  const userRoles = new Set((actor?.roles ?? []).map((r) => r.trim().toLowerCase()));
  const isSuperOrAdmin = userRoles.has('super_admin') || userRoles.has('admin');

  const scopeContext = {
    workflowCode: instance.workflowCode,
    entityType: instance.entityType,
    organizationUnitId: instance.organizationUnitId ?? null,
  };

  if (pendingForState.length > 0) {
    // 9.4.3: Chỉ mở bước có stepOrder hiện tại (bước sau chỉ mở khi bước trước hoàn thành)
    const minStepOrder = Math.min(...pendingForState.map((s) => Number(s.stepOrder ?? 1)));
    const activeStepOrder = pendingForState.some(
      (s) => Number(s.stepOrder ?? 1) === Number(instance.currentStepOrder ?? 1),
    )
      ? Number(instance.currentStepOrder ?? 1)
      : minStepOrder;

    const openSteps = pendingForState.filter((s) => Number(s.stepOrder ?? 1) === activeStepOrder);

    let delegatedFromId: number | null = null;

    // 1. Khớp trực tiếp theo approverUserId
    let matchingStep = openSteps.find(
      (s) =>
        actorId !== null &&
        s.approverUserId !== null &&
        s.approverUserId !== undefined &&
        Number(s.approverUserId) === Number(actorId),
    );

    // 2. Khớp theo cấu hình ủy quyền có thời gian & phạm vi (9.4.7)
    if (!matchingStep && actorId !== null && delegationRules && delegationRules.length > 0) {
      matchingStep = openSteps.find((s) => {
        if (s.approverUserId === null || s.approverUserId === undefined) return false;
        const rule = findActiveDelegationRuleForApprover({
          approverUserId: Number(s.approverUserId),
          delegationRules,
          scopeContext,
        });
        if (rule && Number(rule.toUserId) === Number(actorId)) {
          delegatedFromId = Number(s.approverUserId);
          return true;
        }
        return false;
      });
    }

    // 3. Khớp theo vai trò approverRoleCode (9.4.2)
    if (!matchingStep) {
      matchingStep = openSteps.find(
        (s) =>
          Boolean(s.approverRoleCode?.trim()) &&
          userRoles.has(s.approverRoleCode!.trim().toLowerCase()),
      );
    }

    // 4. Cho phép Admin/SuperAdmin hoặc lời gọi hệ thống (actorId === null)
    if (!matchingStep && (isSuperOrAdmin || actorId === null)) {
      matchingStep = openSteps[0];
    }

    if (!matchingStep) {
      throw new ForbiddenAppException('workflows.notAssignedApproverForStep', [
        {
          currentStateCode: instance.currentStateCode,
          currentStepOrder: activeStepOrder,
          actorUserId: actorId,
        },
      ]);
    }

    if (delegatedFromId !== null) {
      matchingStep.delegatedFromUserId = delegatedFromId;
      matchingStep.approverUserId = actorId;
    }

    matchingStep.decision = dto.decision;
    matchingStep.comment = dto.comment?.trim() || null;
    matchingStep.decidedAt = new Date();
    matchingStep.decidedByUserId = actorId;
    await approvalStepRepository.saveEntity(matchingStep);

    // 9.4.4: Phê duyệt song song (ANY / QUORUM / minApprovals / ALL)
    if (dto.decision === WORKFLOW_APPROVAL_DECISION.APPROVED) {
      const mode =
        matchingStep.approvalMode ?? approvalConfig?.mode ?? WORKFLOW_APPROVAL_MODE.SINGLE;
      const configuredMinApprovals =
        approvalConfig?.minApprovals !== undefined &&
        approvalConfig?.minApprovals !== null &&
        Number(approvalConfig.minApprovals) > 0
          ? Number(approvalConfig.minApprovals)
          : null;

      const requiredApprovalsForOrder =
        mode === WORKFLOW_APPROVAL_MODE.ANY
          ? 1
          : mode === WORKFLOW_APPROVAL_MODE.QUORUM || configuredMinApprovals !== null
            ? (configuredMinApprovals ?? 1)
            : null;

      if (requiredApprovalsForOrder !== null) {
        const stepsInSameOrder = steps.filter(
          (s) =>
            s.stateCode.toUpperCase() === instance.currentStateCode.toUpperCase() &&
            Number(s.stepOrder ?? 1) === activeStepOrder,
        );
        const approvedCount = stepsInSameOrder.filter(
          (s) => s.id === matchingStep!.id || s.decision === WORKFLOW_APPROVAL_DECISION.APPROVED,
        ).length;

        if (approvedCount >= requiredApprovalsForOrder) {
          for (const other of openSteps) {
            if (
              other.id !== matchingStep.id &&
              other.decision === WORKFLOW_APPROVAL_DECISION.PENDING
            ) {
              other.decision = WORKFLOW_APPROVAL_DECISION.SKIPPED;
              other.decidedAt = new Date();
              await approvalStepRepository.saveEntity(other);
            }
          }
        }
      }
    } else if (
      dto.decision === WORKFLOW_APPROVAL_DECISION.REJECTED ||
      dto.decision === WORKFLOW_APPROVAL_DECISION.RETURNED
    ) {
      // 9.4.5 & 9.4.6: Khi từ chối hoặc trả lại bước trước, hủy (SKIPPED) toàn bộ các bước PENDING còn lại của state này
      for (const other of pendingForState) {
        if (other.id !== matchingStep.id && other.decision === WORKFLOW_APPROVAL_DECISION.PENDING) {
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

  const trimmedReason = dto.comment?.trim() || `Quyết định phê duyệt: ${dto.decision}`;

  await historyRepository.recordHistory({
    workflowInstanceId: Number(instance.id),
    transitionCode: dto.decision,
    actionType: historyAction,
    fromStateCode: instance.currentStateCode,
    toStateCode: instance.currentStateCode,
    actorUserId: actorId,
    reason: trimmedReason,
  });

  const refreshedSteps = await approvalStepRepository.findByInstanceId(Number(instance.id));
  const remainingPending = refreshedSteps.filter(
    (s) =>
      s.stateCode.toUpperCase() === instance.currentStateCode.toUpperCase() &&
      s.decision === WORKFLOW_APPROVAL_DECISION.PENDING,
  );

  if (dto.decision === 'REJECTED' || dto.decision === 'RETURNED' || remainingPending.length === 0) {
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
          reason: trimmedReason,
        },
        actor,
      );
    }

    // 9.4.6 Fallback: Nếu quyết định là RETURNED nhưng quy trình chưa khai báo transition RETURN tường minh,
    // tự động trả về trạng thái returnToStateCode hoặc trạng thái INITIAL (DRAFT) cho người tạo chỉnh sửa
    if (dto.decision === 'RETURNED') {
      const initialState =
        states.find((s) => s.stateType === WORKFLOW_STATE_TYPE.INITIAL) ?? states[0];
      const fallbackReturnStateCode = (
        approvalConfig?.returnToStateCode?.trim() ||
        initialState?.code ||
        'DRAFT'
      ).toUpperCase();
      const fromStateCode = instance.currentStateCode;
      instance.currentStateCode = fallbackReturnStateCode;
      instance.currentStepOrder = 1;
      instance.warningSentAt = null;
      instance.overdueNotifiedAt = null;
      instance.isOverdue = false;
      await instanceRepository.saveEntity(instance);

      await historyRepository.recordHistory({
        workflowInstanceId: Number(instance.id),
        transitionCode: 'RETURN',
        actionType: WORKFLOW_HISTORY_ACTION_TYPE.TRANSITION,
        fromStateCode,
        toStateCode: fallbackReturnStateCode,
        actorUserId: actorId,
        reason: trimmedReason,
      });
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
  if (instance.status !== WORKFLOW_INSTANCE_STATUS.RUNNING) {
    throw new BadRequestAppException('workflows.instanceNotRunning', [{ id }]);
  }

  // 9.4.7: Kiểm tra thời gian hiệu lực nếu có truyền effectiveFrom / effectiveUntil
  const nowMs = Date.now();
  if (dto.effectiveFrom || dto.effectiveUntil) {
    const fromMs = dto.effectiveFrom ? new Date(dto.effectiveFrom).getTime() : nowMs;
    const untilMs = dto.effectiveUntil
      ? new Date(dto.effectiveUntil).getTime()
      : nowMs + 365 * 24 * 3600_000;
    if (Number.isNaN(fromMs) || Number.isNaN(untilMs) || fromMs >= untilMs || nowMs > untilMs) {
      throw new BadRequestAppException('workflows.invalidDelegationTimeRange', [
        { effectiveFrom: dto.effectiveFrom ?? null, effectiveUntil: dto.effectiveUntil ?? null },
      ]);
    }
  }

  // 9.4.7: Kiểm tra phạm vi ủy quyền (workflowCodes, entityTypes, organizationUnitId)
  if (
    !isDelegationScopeMatched(
      {
        workflowCodes: dto.workflowCodes,
        entityTypes: dto.entityTypes,
        organizationUnitId: dto.organizationUnitId,
      },
      {
        workflowCode: instance.workflowCode,
        entityType: instance.entityType,
        organizationUnitId: instance.organizationUnitId ?? null,
      },
    )
  ) {
    throw new BadRequestAppException('workflows.delegationScopeMismatch', [
      {
        workflowCode: instance.workflowCode,
        entityType: instance.entityType,
        organizationUnitId: instance.organizationUnitId ?? null,
      },
    ]);
  }

  const steps = await approvalStepRepository.findByInstanceId(Number(instance.id));
  const pendingForState = steps.filter(
    (s) =>
      s.stateCode.toUpperCase() === instance.currentStateCode.toUpperCase() &&
      s.decision === WORKFLOW_APPROVAL_DECISION.PENDING,
  );
  if (pendingForState.length === 0) {
    throw new BadRequestAppException('workflows.noPendingApprovalStepToDelegate', [{ id }]);
  }

  const minStepOrder = Math.min(...pendingForState.map((s) => Number(s.stepOrder ?? 1)));
  const activeStepOrder = pendingForState.some(
    (s) => Number(s.stepOrder ?? 1) === Number(instance.currentStepOrder ?? 1),
  )
    ? Number(instance.currentStepOrder ?? 1)
    : minStepOrder;
  const openSteps = pendingForState.filter((s) => Number(s.stepOrder ?? 1) === activeStepOrder);

  const actorId = actor?.id ?? null;
  const userRoles = new Set((actor?.roles ?? []).map((r) => r.trim().toLowerCase()));
  const isSuperOrAdmin = userRoles.has('super_admin') || userRoles.has('admin');

  const pendingStep =
    openSteps.find(
      (s) =>
        actorId !== null &&
        s.approverUserId !== null &&
        s.approverUserId !== undefined &&
        Number(s.approverUserId) === Number(actorId),
    ) ??
    openSteps.find(
      (s) =>
        Boolean(s.approverRoleCode?.trim()) &&
        userRoles.has(s.approverRoleCode!.trim().toLowerCase()),
    ) ??
    (isSuperOrAdmin || actorId === null ? openSteps[0] : undefined);

  if (!pendingStep) {
    throw new ForbiddenAppException('workflows.notAssignedApproverForStep', [
      { id, actorUserId: actorId },
    ]);
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
      ...(dto.effectiveFrom ? { effectiveFrom: dto.effectiveFrom } : {}),
      ...(dto.effectiveUntil ? { effectiveUntil: dto.effectiveUntil } : {}),
      ...(dto.workflowCodes ? { workflowCodes: dto.workflowCodes } : {}),
      ...(dto.entityTypes ? { entityTypes: dto.entityTypes } : {}),
      ...(dto.organizationUnitId !== undefined
        ? { organizationUnitId: dto.organizationUnitId }
        : {}),
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

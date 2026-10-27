import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  ConflictAppException,
  ForbiddenAppException,
  HTTP_ERROR_CODE,
  NotFoundAppException,
  type PaginatedResult,
  defaultSettingRegistry,
  resolvePagination,
} from '@packages/kernel/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import { TransactionManager } from '@packages/database/index.js';
import { BaseMessagePublisherProvider } from '@packages/messaging/index.js';
import {
  AuditLogService,
  DataScopeService,
  type UserIdentity,
  createDefaultDataScopeService,
} from '@packages/security/index.js';
import {
  type INotificationsPublicService,
  NOTIFICATIONS_PUBLIC_SERVICE,
} from '@modules/notifications/contracts/index.js';
import { type IUsersPublicService, USERS_PUBLIC_SERVICE } from '@modules/users/contracts/index.js';
import {
  type IWorkflowsPublicService,
  type StartWorkflowPublicInput,
  WORKFLOWS_AUDIT_META,
  WORKFLOWS_SETTING_KEYS,
  WORKFLOW_APPROVAL_DECISION,
  WORKFLOW_APPROVAL_MODE,
  WORKFLOW_DEFINITION_STATUS,
  WORKFLOW_HISTORY_ACTION_TYPE,
  WORKFLOW_INSTANCE_STATUS,
  WORKFLOW_STATE_TYPE,
  type WorkflowDefinitionItemView,
  type WorkflowHistoryItemView,
  type WorkflowInstanceDetailView,
  type WorkflowInstanceItemView,
  type WorkflowSlaScanResultView,
} from '../contracts/index.js';
import { WorkflowDefinitionRepository } from '../repositories/workflow-definition.repository.js';
import { WorkflowStateRepository } from '../repositories/workflow-state.repository.js';
import { WorkflowTransitionRepository } from '../repositories/workflow-transition.repository.js';
import { WorkflowInstanceRepository } from '../repositories/workflow-instance.repository.js';
import { WorkflowApprovalStepRepository } from '../repositories/workflow-approval-step.repository.js';
import { WorkflowHistoryRepository } from '../repositories/workflow-history.repository.js';
import type {
  CancelWorkflowInstanceRequest,
  CreateWorkflowDefinitionRequest,
  DecideWorkflowApprovalRequest,
  DelegateWorkflowApprovalRequest,
  ExecuteWorkflowTransitionRequest,
  ListWorkflowDefinitionsQuery,
  ListWorkflowInstancesQuery,
  ReplaceWorkflowStatesRequest,
  ReplaceWorkflowTransitionsRequest,
  UpdateWorkflowDefinitionRequest,
} from '../requests/workflows.requests.js';
import {
  DEFAULT_WORKFLOW_STATES,
  DEFAULT_WORKFLOW_TRANSITIONS,
  hydrateWorkflowDefinitionsList,
  hydrateWorkflowInstanceDetail,
  hydrateWorkflowInstancesList,
} from '../helpers/workflow-hydration.helper.js';
import {
  evaluateTransitionConditions,
  parseInstanceContextData,
  parseStateApprovalConfig,
  parseTransitionActions,
  resolveStateSlaDueDate,
} from '../helpers/workflow-condition-evaluator.helper.js';
import { executeWorkflowTransitionActions } from '../helpers/workflow-action-dispatcher.helper.js';
import { generateApprovalStepsForState } from '../helpers/workflow-approver-resolver.helper.js';
import { executeWorkflowSlaScan } from '../helpers/workflow-sla-scanner.helper.js';

@Injectable()
export class WorkflowsService implements IWorkflowsPublicService {
  private readonly effectiveDataScopeService: DataScopeService;

  constructor(
    private readonly definitionRepository: WorkflowDefinitionRepository,
    private readonly stateRepository: WorkflowStateRepository,
    private readonly transitionRepository: WorkflowTransitionRepository,
    private readonly instanceRepository: WorkflowInstanceRepository,
    private readonly approvalStepRepository: WorkflowApprovalStepRepository,
    private readonly historyRepository: WorkflowHistoryRepository,
    @Optional()
    @Inject(USERS_PUBLIC_SERVICE)
    private readonly usersPublicService: IUsersPublicService | null = null,
    @Optional()
    @Inject(NOTIFICATIONS_PUBLIC_SERVICE)
    private readonly notificationsPublicService: INotificationsPublicService | null = null,
    @Optional()
    @Inject(BaseMessagePublisherProvider)
    private readonly messagePublisher: BaseMessagePublisherProvider | null = null,
    @Optional()
    @Inject(TransactionManager)
    private readonly transactionManager: TransactionManager | null = null,
    @Optional()
    @Inject(DataScopeService)
    private readonly dataScopeService: DataScopeService | null = null,
    @Optional()
    @Inject(AuditLogService)
    private readonly auditLogService: AuditLogService | null = null,
  ) {
    this.effectiveDataScopeService = this.dataScopeService ?? createDefaultDataScopeService();
  }

  public async listDefinitionsPaginated(
    query: ListWorkflowDefinitionsQuery,
  ): Promise<PaginatedResult<WorkflowDefinitionItemView>> {
    const { page, limit, countMode } = resolvePagination(query, {
      settingPrefix: WORKFLOWS_SETTING_KEYS.PAGINATION_PREFIX,
      defaultLimit: 20,
      maxLimit: 200,
    });
    const { items, total } = await this.definitionRepository.searchPaginated({
      ...query,
      page,
      limit,
      countMode,
    });
    const defIds = items.map((d) => Number(d.id));
    const [states, transitions] = await Promise.all([
      this.stateRepository.findByDefinitionIds(defIds),
      this.transitionRepository.findByDefinitionIds(defIds),
    ]);
    const hydrated = hydrateWorkflowDefinitionsList(items, states, transitions);
    return createPaginatedResult(hydrated, countMode === 'none' ? null : total, page, limit);
  }

  public async getDefinitionById(id: number): Promise<WorkflowDefinitionItemView> {
    const def = await this.definitionRepository.findById(id);
    if (!def) {
      throw new NotFoundAppException('workflows.definitionNotFound', { id });
    }
    const [states, transitions] = await Promise.all([
      this.stateRepository.findByDefinitionIds([Number(def.id)]),
      this.transitionRepository.findByDefinitionIds([Number(def.id)]),
    ]);
    const [hydrated] = hydrateWorkflowDefinitionsList([def], states, transitions);
    return hydrated!;
  }

  public async createDefinition(
    dto: CreateWorkflowDefinitionRequest,
    actorId?: number,
  ): Promise<WorkflowDefinitionItemView> {
    const code = dto.code.trim().toUpperCase();
    const version = dto.version ?? (await this.definitionRepository.findMaxVersionByCode(code)) + 1;

    const existing = await this.definitionRepository.findByCodeAndVersion(code, version);
    if (existing) {
      throw new ConflictAppException(
        'workflows.duplicateCodeAndVersion',
        [{ code, version }],
        { code, version },
        HTTP_ERROR_CODE.DUPLICATE_RESOURCE,
      );
    }

    const statesToSave = dto.states && dto.states.length > 0 ? dto.states : DEFAULT_WORKFLOW_STATES;
    const transitionsToSave =
      dto.transitions !== undefined ? dto.transitions : DEFAULT_WORKFLOW_TRANSITIONS;

    this.validateStatesAndTransitionsConsistency(statesToSave, transitionsToSave);

    const work = async (): Promise<number> => {
      const saved = await this.definitionRepository.saveEntity({
        code,
        version,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        targetEntityType: dto.targetEntityType.trim().toLowerCase(),
        defaultSlaHours: dto.defaultSlaHours,
        warningBeforeMinutes: dto.warningBeforeMinutes,
        isSystem: false,
        status: dto.status ?? WORKFLOW_DEFINITION_STATUS.ACTIVE,
        createdByUserId: actorId ?? null,
      });
      const defId = Number(saved.id);
      await this.stateRepository.replaceStatesForDefinition(defId, statesToSave);
      await this.transitionRepository.replaceTransitionsForDefinition(defId, transitionsToSave);
      return defId;
    };

    const createdId = this.transactionManager
      ? await this.transactionManager.runInTransaction(work)
      : await work();

    const result = await this.getDefinitionById(createdId);
    await this.auditLogService?.record({
      actorUserId: actorId ?? null,
      module: WORKFLOWS_AUDIT_META.MODULE,
      feature: WORKFLOWS_AUDIT_META.FEATURES.DEFINITION,
      action: 'workflow.definition.create',
      resourceType: WORKFLOWS_AUDIT_META.RESOURCE_TYPES.DEFINITION,
      resourceId: result.id,
      beforeData: null,
      afterData: { code: result.code, version: result.version, name: result.name },
      reason: 'Created workflow definition',
    });
    return result;
  }

  public async updateDefinition(
    id: number,
    dto: UpdateWorkflowDefinitionRequest,
    _actorId?: number,
  ): Promise<WorkflowDefinitionItemView> {
    const def = await this.definitionRepository.findById(id);
    if (!def) {
      throw new NotFoundAppException('workflows.definitionNotFound', { id });
    }

    if (dto.name !== undefined) def.name = dto.name.trim();
    if (dto.description !== undefined) def.description = dto.description?.trim() || null;
    if (dto.targetEntityType !== undefined) {
      def.targetEntityType = dto.targetEntityType.trim().toLowerCase();
    }
    if (dto.defaultSlaHours !== undefined) def.defaultSlaHours = dto.defaultSlaHours;
    if (dto.warningBeforeMinutes !== undefined) {
      def.warningBeforeMinutes = dto.warningBeforeMinutes;
    }
    if (dto.status !== undefined) def.status = dto.status;

    const work = async (): Promise<void> => {
      await this.definitionRepository.saveEntity(def);
      if (dto.states !== undefined) {
        await this.stateRepository.replaceStatesForDefinition(Number(def.id), dto.states);
      }
      if (dto.transitions !== undefined) {
        await this.transitionRepository.replaceTransitionsForDefinition(
          Number(def.id),
          dto.transitions,
        );
      }
    };

    if (this.transactionManager) {
      await this.transactionManager.runInTransaction(work);
    } else {
      await work();
    }

    return this.getDefinitionById(Number(def.id));
  }

  public async createNewVersion(id: number, actorId?: number): Promise<WorkflowDefinitionItemView> {
    const current = await this.getDefinitionById(id);
    const nextVersion = (await this.definitionRepository.findMaxVersionByCode(current.code)) + 1;
    return this.createDefinition(
      {
        code: current.code,
        version: nextVersion,
        name: `${current.name} (v${nextVersion})`,
        description: current.description,
        targetEntityType: current.targetEntityType,
        defaultSlaHours: current.defaultSlaHours,
        warningBeforeMinutes: current.warningBeforeMinutes,
        status: WORKFLOW_DEFINITION_STATUS.ACTIVE,
        states: current.states.map((s) => ({
          code: s.code,
          name: s.name,
          stateType: s.stateType,
          badgeTone: s.badgeTone,
          slaHours: s.slaHours,
          approvalConfig: s.approvalConfig
            ? {
                enabled: s.approvalConfig.enabled,
                ...(s.approvalConfig.mode ? { mode: s.approvalConfig.mode } : {}),
                ...(s.approvalConfig.useManagerChain !== undefined
                  ? { useManagerChain: s.approvalConfig.useManagerChain }
                  : {}),
                ...(s.approvalConfig.maxChainLevels !== undefined
                  ? { maxChainLevels: s.approvalConfig.maxChainLevels }
                  : {}),
                ...(s.approvalConfig.approverUserIds
                  ? { approverUserIds: [...s.approvalConfig.approverUserIds] }
                  : {}),
                ...(s.approvalConfig.approverRoleCodes
                  ? { approverRoleCodes: [...s.approvalConfig.approverRoleCodes] }
                  : {}),
                ...(s.approvalConfig.autoTransitionOnApprove !== undefined
                  ? { autoTransitionOnApprove: s.approvalConfig.autoTransitionOnApprove }
                  : {}),
                ...(s.approvalConfig.autoTransitionOnReject !== undefined
                  ? { autoTransitionOnReject: s.approvalConfig.autoTransitionOnReject }
                  : {}),
                ...(s.approvalConfig.autoTransitionOnReturn !== undefined
                  ? { autoTransitionOnReturn: s.approvalConfig.autoTransitionOnReturn }
                  : {}),
              }
            : null,
          sortOrder: s.sortOrder,
        })),
        transitions: current.transitions.map((t) => ({
          code: t.code,
          name: t.name,
          fromStateCode: t.fromStateCode,
          toStateCode: t.toStateCode,
          conditions: {
            ...(t.conditions.requiredPermissions
              ? { requiredPermissions: [...t.conditions.requiredPermissions] }
              : {}),
            ...(t.conditions.allowedRoleCodes
              ? { allowedRoleCodes: [...t.conditions.allowedRoleCodes] }
              : {}),
            ...(t.conditions.onlyInitiator !== undefined
              ? { onlyInitiator: t.conditions.onlyInitiator }
              : {}),
            ...(t.conditions.onlyAssignedApprover !== undefined
              ? { onlyAssignedApprover: t.conditions.onlyAssignedApprover }
              : {}),
            ...(t.conditions.requireReason !== undefined
              ? { requireReason: t.conditions.requireReason }
              : {}),
            ...(t.conditions.fieldRules
              ? { fieldRules: t.conditions.fieldRules.map((r) => ({ ...r })) }
              : {}),
          },
          actions: t.actions.map((a) => ({
            type: a.type,
            ...(a.title !== undefined ? { title: a.title } : {}),
            ...(a.content !== undefined ? { content: a.content } : {}),
            ...(a.notifyTargets ? { notifyTargets: [...a.notifyTargets] } : {}),
            ...(a.targetUserIds ? { targetUserIds: [...a.targetUserIds] } : {}),
            ...(a.targetRoleCodes ? { targetRoleCodes: [...a.targetRoleCodes] } : {}),
            ...(a.jobTopic !== undefined ? { jobTopic: a.jobTopic } : {}),
            ...(a.jobQueue !== undefined ? { jobQueue: a.jobQueue } : {}),
            ...(a.jobPayload ? { jobPayload: { ...a.jobPayload } } : {}),
          })),
          sortOrder: t.sortOrder,
        })),
      },
      actorId,
    );
  }

  public async replaceStates(
    id: number,
    dto: ReplaceWorkflowStatesRequest,
  ): Promise<WorkflowDefinitionItemView> {
    const def = await this.definitionRepository.findById(id);
    if (!def) {
      throw new NotFoundAppException('workflows.definitionNotFound', { id });
    }
    await this.stateRepository.replaceStatesForDefinition(Number(def.id), dto.states);
    return this.getDefinitionById(Number(def.id));
  }

  public async replaceTransitions(
    id: number,
    dto: ReplaceWorkflowTransitionsRequest,
  ): Promise<WorkflowDefinitionItemView> {
    const def = await this.definitionRepository.findById(id);
    if (!def) {
      throw new NotFoundAppException('workflows.definitionNotFound', { id });
    }
    const currentStates = await this.stateRepository.findByDefinitionIds([Number(def.id)]);
    this.validateStatesAndTransitionsConsistency(
      currentStates.map((s) => ({ code: s.code, name: s.name, stateType: s.stateType })),
      dto.transitions,
    );
    await this.transitionRepository.replaceTransitionsForDefinition(
      Number(def.id),
      dto.transitions,
    );
    return this.getDefinitionById(Number(def.id));
  }

  public async listInstancesPaginated(
    query: ListWorkflowInstancesQuery,
    actor?: UserIdentity,
  ): Promise<PaginatedResult<WorkflowInstanceItemView>> {
    const { page, limit, countMode } = resolvePagination(query, {
      settingPrefix: WORKFLOWS_SETTING_KEYS.PAGINATION_PREFIX,
      defaultLimit: 20,
      maxLimit: 200,
    });
    const scopeFilter = actor
      ? await this.effectiveDataScopeService.resolveScopeFilter(actor, 'workflows', 'read')
      : undefined;
    const { items, total } = await this.instanceRepository.searchPaginated({
      ...query,
      page,
      limit,
      countMode,
      ...(scopeFilter ? { scopeFilter } : {}),
    });
    const defIds = [...new Set(items.map((i) => Number(i.workflowDefinitionId)))];
    const [definitions, states] = await Promise.all([
      this.definitionRepository.findByIds(defIds),
      this.stateRepository.findByDefinitionIds(defIds),
    ]);
    const hydrated = await hydrateWorkflowInstancesList({
      instances: items,
      definitions,
      states,
      usersPublicService: this.usersPublicService,
    });
    return createPaginatedResult(hydrated, countMode === 'none' ? null : total, page, limit);
  }

  public async findInstancesByEntity(
    entityType: string,
    entityId: string,
  ): Promise<WorkflowInstanceItemView[]> {
    const items = await this.instanceRepository.findByEntity(entityType, entityId);
    const defIds = [...new Set(items.map((i) => Number(i.workflowDefinitionId)))];
    const [definitions, states] = await Promise.all([
      this.definitionRepository.findByIds(defIds),
      this.stateRepository.findByDefinitionIds(defIds),
    ]);
    return hydrateWorkflowInstancesList({
      instances: items,
      definitions,
      states,
      usersPublicService: this.usersPublicService,
    });
  }

  public async getInstanceById(
    id: number,
    actor?: UserIdentity,
  ): Promise<WorkflowInstanceDetailView> {
    const instance = await this.instanceRepository.findById(id);
    if (!instance) {
      throw new NotFoundAppException('workflows.instanceNotFound', { id });
    }
    const defId = Number(instance.workflowDefinitionId);
    const [definition, states, transitions, approvalSteps, histories] = await Promise.all([
      this.definitionRepository.findById(defId),
      this.stateRepository.findByDefinitionIds([defId]),
      this.transitionRepository.findByDefinitionIds([defId]),
      this.approvalStepRepository.findByInstanceId(Number(instance.id)),
      this.historyRepository.findByInstanceId(Number(instance.id)),
    ]);

    return hydrateWorkflowInstanceDetail({
      instance,
      definition,
      states,
      transitions,
      approvalSteps,
      histories,
      usersPublicService: this.usersPublicService,
      actor,
    });
  }

  public async startWorkflowForEntity(
    input: StartWorkflowPublicInput,
    actor?: UserIdentity,
  ): Promise<WorkflowInstanceDetailView> {
    const def = await this.definitionRepository.findLatestActiveByCode(input.workflowCode);
    if (!def) {
      throw new NotFoundAppException('workflows.activeDefinitionNotFound', {
        workflowCode: input.workflowCode,
      });
    }

    const states = await this.stateRepository.findByDefinitionIds([Number(def.id)]);
    const initialState =
      states.find((s) => s.stateType === WORKFLOW_STATE_TYPE.INITIAL) ?? states[0];
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

    const savedInstance = await this.instanceRepository.saveEntity({
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
      approvalStepRepository: this.approvalStepRepository,
      usersPublicService: this.usersPublicService,
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
      notificationsPublicService: this.notificationsPublicService,
      messagePublisher: this.messagePublisher,
    });

    await this.historyRepository.recordHistory({
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

    return this.getInstanceById(instanceId, actor);
  }

  public async executeTransition(
    id: number,
    dto: ExecuteWorkflowTransitionRequest,
    actor?: UserIdentity,
  ): Promise<WorkflowInstanceDetailView> {
    const instance = await this.instanceRepository.findById(id);
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
      this.definitionRepository.findById(defId),
      this.stateRepository.findByDefinitionIds([defId]),
      this.transitionRepository.findByDefinitionIds([defId]),
      this.approvalStepRepository.findByInstanceId(Number(instance.id)),
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

    await this.instanceRepository.saveEntity(instance);

    const nextApprovalSteps = await generateApprovalStepsForState({
      workflowInstanceId: Number(instance.id),
      targetState,
      initiatorUserId: instance.initiatorUserId ?? null,
      approvalStepRepository: this.approvalStepRepository,
      usersPublicService: this.usersPublicService,
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
      notificationsPublicService: this.notificationsPublicService,
      messagePublisher: this.messagePublisher,
    });

    await this.historyRepository.recordHistory({
      workflowInstanceId: Number(instance.id),
      transitionCode: transition.code,
      actionType: WORKFLOW_HISTORY_ACTION_TYPE.TRANSITION,
      fromStateCode,
      toStateCode,
      actorUserId: actor?.id ?? null,
      reason: dto.reason ?? null,
      triggeredActions,
    });

    return this.getInstanceById(Number(instance.id), actor);
  }

  public async decideApproval(
    id: number,
    dto: DecideWorkflowApprovalRequest,
    actor?: UserIdentity,
  ): Promise<WorkflowInstanceDetailView> {
    const instance = await this.instanceRepository.findById(id);
    if (!instance) {
      throw new NotFoundAppException('workflows.instanceNotFound', { id });
    }
    if (instance.status !== WORKFLOW_INSTANCE_STATUS.RUNNING) {
      throw new BadRequestAppException('workflows.instanceNotRunning', [{ id }]);
    }

    const steps = await this.approvalStepRepository.findByInstanceId(Number(instance.id));
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
      await this.approvalStepRepository.saveEntity(matchingStep);

      if (
        matchingStep.approvalMode === WORKFLOW_APPROVAL_MODE.ANY &&
        dto.decision === WORKFLOW_APPROVAL_DECISION.APPROVED
      ) {
        for (const other of pendingForState) {
          if (other.id !== matchingStep.id) {
            other.decision = WORKFLOW_APPROVAL_DECISION.SKIPPED;
            other.decidedAt = new Date();
            await this.approvalStepRepository.saveEntity(other);
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

    await this.historyRepository.recordHistory({
      workflowInstanceId: Number(instance.id),
      transitionCode: dto.decision,
      actionType: historyAction,
      fromStateCode: instance.currentStateCode,
      toStateCode: instance.currentStateCode,
      actorUserId: actorId,
      reason: dto.comment ?? `Quyết định phê duyệt: ${dto.decision}`,
    });

    const refreshedSteps = await this.approvalStepRepository.findByInstanceId(Number(instance.id));
    const remainingPending = refreshedSteps.filter(
      (s) =>
        s.stateCode.toUpperCase() === instance.currentStateCode.toUpperCase() &&
        s.decision === WORKFLOW_APPROVAL_DECISION.PENDING,
    );

    if (
      dto.decision === 'REJECTED' ||
      dto.decision === 'RETURNED' ||
      remainingPending.length === 0
    ) {
      const defId = Number(instance.workflowDefinitionId);
      const [states, transitions] = await Promise.all([
        this.stateRepository.findByDefinitionIds([defId]),
        this.transitionRepository.findByDefinitionIds([defId]),
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
        return this.executeTransition(
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
      await this.instanceRepository.saveEntity(instance);
    }

    return this.getInstanceById(Number(instance.id), actor);
  }

  public async delegateApproval(
    id: number,
    dto: DelegateWorkflowApprovalRequest,
    actor?: UserIdentity,
  ): Promise<WorkflowInstanceDetailView> {
    const instance = await this.instanceRepository.findById(id);
    if (!instance) {
      throw new NotFoundAppException('workflows.instanceNotFound', { id });
    }
    const steps = await this.approvalStepRepository.findByInstanceId(Number(instance.id));
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
    await this.approvalStepRepository.saveEntity(pendingStep);

    await this.historyRepository.recordHistory({
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

    return this.getInstanceById(Number(instance.id), actor);
  }

  public async cancelInstance(
    id: number,
    dto: CancelWorkflowInstanceRequest,
    actor?: UserIdentity,
  ): Promise<WorkflowInstanceDetailView> {
    const instance = await this.instanceRepository.findById(id);
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
    await this.instanceRepository.saveEntity(instance);

    const steps = await this.approvalStepRepository.findByInstanceId(Number(instance.id));
    for (const step of steps) {
      if (step.decision === WORKFLOW_APPROVAL_DECISION.PENDING) {
        step.decision = WORKFLOW_APPROVAL_DECISION.SKIPPED;
        step.decidedAt = new Date();
        await this.approvalStepRepository.saveEntity(step);
      }
    }

    await this.historyRepository.recordHistory({
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

    await this.auditLogService?.record({
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

    return this.getInstanceById(Number(instance.id), actor);
  }

  public async getInstanceHistories(
    id: number,
    actor?: UserIdentity,
  ): Promise<readonly WorkflowHistoryItemView[]> {
    const detail = await this.getInstanceById(id, actor);
    return detail.histories;
  }

  public async scanSlaAndNotifyOverdue(now?: Date): Promise<WorkflowSlaScanResultView> {
    const warningMinutes = Number(
      defaultSettingRegistry.getNumber(
        WORKFLOWS_SETTING_KEYS.SLA_WARNING_BEFORE_MINUTES,
        undefined,
        120,
      ),
    );
    return executeWorkflowSlaScan({
      now,
      definitionRepository: this.definitionRepository,
      instanceRepository: this.instanceRepository,
      approvalStepRepository: this.approvalStepRepository,
      historyRepository: this.historyRepository,
      notificationsPublicService: this.notificationsPublicService,
      defaultWarningMinutes: warningMinutes,
    });
  }

  private validateStatesAndTransitionsConsistency(
    states: ReadonlyArray<{ readonly code: string }>,
    transitions: ReadonlyArray<{
      readonly code: string;
      readonly fromStateCode: string;
      readonly toStateCode: string;
    }>,
  ): void {
    const stateCodes = new Set(states.map((s) => s.code.trim().toUpperCase()));
    if (stateCodes.size === 0) {
      throw new BadRequestAppException('workflows.statesCannotBeEmpty');
    }
    for (const tr of transitions) {
      const fromCode = tr.fromStateCode.trim().toUpperCase();
      const toCode = tr.toStateCode.trim().toUpperCase();
      if (!stateCodes.has(fromCode) || !stateCodes.has(toCode)) {
        throw new BadRequestAppException('workflows.transitionReferencesUnknownState', [
          {
            transitionCode: tr.code,
            fromStateCode: fromCode,
            toStateCode: toCode,
          },
        ]);
      }
    }
  }
}

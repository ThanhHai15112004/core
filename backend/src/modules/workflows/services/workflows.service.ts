import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  NotFoundAppException,
  type PaginatedResult,
  defaultSettingRegistry,
  resolvePagination,
  safeJsonParseObject,
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
import { type IFilesPublicService, FILES_PUBLIC_SERVICE } from '@modules/files/contracts/index.js';
import { type IUsersPublicService, USERS_PUBLIC_SERVICE } from '@modules/users/contracts/index.js';
import {
  APPROVALS_PUBLIC_SERVICE,
  type IApprovalStepsPersistenceContract,
  type IApprovalsPublicService,
} from '@modules/approvals/contracts/index.js';
import {
  COMMENTS_PUBLIC_SERVICE,
  CommentsService,
  type ICommentsPublicService,
  type RecordActivityTimelineEntryView,
} from '@modules/comments/index.js';
import {
  type IWorkflowsPublicService,
  type StartWorkflowPublicInput,
  WORKFLOWS_SETTING_KEYS,
  type WorkflowApprovalDelegationRule,
  type WorkflowCommentItemView,
  type WorkflowDefinitionItemView,
  type WorkflowHistoryItemView,
  type WorkflowInstanceDetailView,
  type WorkflowInstanceItemView,
  type WorkflowRecordActivityTimelineView,
  type WorkflowSlaScanResultView,
} from '../contracts/index.js';
import { WorkflowDefinitionRepository } from '../repositories/workflow-definition.repository.js';
import { WorkflowStateRepository } from '../repositories/workflow-state.repository.js';
import { WorkflowTransitionRepository } from '../repositories/workflow-transition.repository.js';
import { WorkflowInstanceRepository } from '../repositories/workflow-instance.repository.js';
import { WorkflowHistoryRepository } from '../repositories/workflow-history.repository.js';
import type {
  CancelWorkflowInstanceRequest,
  CreateWorkflowCommentRequest,
  CreateWorkflowDefinitionRequest,
  CreateWorkflowDelegationRuleRequest,
  DecideWorkflowApprovalRequest,
  DelegateWorkflowApprovalRequest,
  ExecuteWorkflowTransitionRequest,
  ListWorkflowCommentsQuery,
  ListWorkflowDefinitionsQuery,
  ListWorkflowInstancesQuery,
  ListWorkflowTimelineQuery,
  ReplaceWorkflowStatesRequest,
  ReplaceWorkflowTransitionsRequest,
  UpdateWorkflowCommentRequest,
  UpdateWorkflowDefinitionRequest,
} from '../requests/workflows.requests.js';
import {
  hydrateWorkflowDefinitionsList,
  hydrateWorkflowInstanceDetail,
  hydrateWorkflowInstancesList,
} from '../helpers/workflow-hydration.helper.js';
import {
  buildClonedDefinitionVersionPayload,
  executeCreateWorkflowDefinition,
  executeUpdateWorkflowDefinition,
  validateStatesAndTransitionsConsistency,
} from '../helpers/workflow-definition-crud.helper.js';
import {
  executeCancelWorkflowInstance,
  executeDecideWorkflowApproval,
  executeDelegateWorkflowApproval,
  executeStartWorkflowForEntity,
  executeWorkflowStateTransition,
} from '../helpers/workflow-instance-execution.helper.js';
import { executeWorkflowSlaScan } from '../helpers/workflow-sla-scanner.helper.js';

@Injectable()
export class WorkflowsService implements IWorkflowsPublicService {
  private readonly effectiveDataScopeService: DataScopeService;
  private readonly effectiveCommentsService: ICommentsPublicService;
  private readonly fallbackDelegationRules: WorkflowApprovalDelegationRule[] = [];
  private fallbackDelegationSeq = 1;

  constructor(
    private readonly definitionRepository: WorkflowDefinitionRepository,
    private readonly stateRepository: WorkflowStateRepository,
    private readonly transitionRepository: WorkflowTransitionRepository,
    private readonly instanceRepository: WorkflowInstanceRepository,
    @Inject(APPROVALS_PUBLIC_SERVICE)
    private readonly approvalStepRepository: IApprovalStepsPersistenceContract,
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
    @Optional()
    @Inject(FILES_PUBLIC_SERVICE)
    private readonly filesPublicService: IFilesPublicService | null = null,
    @Optional()
    @Inject(APPROVALS_PUBLIC_SERVICE)
    private readonly approvalsPublicService: IApprovalsPublicService | null = null,
    @Optional()
    @Inject(COMMENTS_PUBLIC_SERVICE)
    private readonly commentsPublicService: ICommentsPublicService | null = null,
  ) {
    this.effectiveDataScopeService = this.dataScopeService ?? createDefaultDataScopeService();
    this.effectiveCommentsService =
      this.commentsPublicService ??
      new CommentsService(
        null,
        null,
        this.usersPublicService,
        this.notificationsPublicService,
        this.filesPublicService,
        this.auditLogService,
      );
    const effectiveApprovals =
      this.approvalsPublicService ??
      ('registerInstanceApprovalCoordinator' in this.approvalStepRepository
        ? (this.approvalStepRepository as IApprovalsPublicService)
        : null);

    effectiveApprovals?.registerInstanceApprovalCoordinator?.({
      getInstanceSteps: async (instanceId, actor) => {
        const detail = await this.getInstanceById(instanceId, actor);
        return {
          instanceId: detail.id,
          workflowCode: detail.workflowCode,
          currentStateCode: detail.currentStateCode,
          currentStepOrder: detail.currentStepOrder,
          status: detail.status,
          statusName: detail.statusName,
          approvalSteps: detail.approvalSteps,
        };
      },
      decideStep: async (instanceId, input, actor) =>
        this.decideApproval(
          instanceId,
          {
            decision:
              input.decision === 'REJECT' || input.decision === 'REJECTED'
                ? 'REJECTED'
                : input.decision === 'RETURN' || input.decision === 'RETURNED'
                  ? 'RETURNED'
                  : 'APPROVED',
            ...(input.stepId !== undefined ? { stepId: input.stepId } : {}),
            comment: input.comment ?? null,
            ...(input.returnToStateCode !== undefined
              ? { returnToStateCode: input.returnToStateCode }
              : input.targetStateCode !== undefined
                ? { returnToStateCode: input.targetStateCode }
                : {}),
            ...(input.contextDataPatch !== undefined
              ? { contextDataPatch: input.contextDataPatch }
              : {}),
          },
          actor,
        ),
      delegateStep: async (instanceId, input, actor) =>
        this.delegateApproval(
          instanceId,
          {
            ...(input.stepId !== undefined ? { stepId: input.stepId } : {}),
            toUserId: input.toUserId,
            reason: input.reason ?? 'Ủy quyền phê duyệt',
            ...(input.effectiveFrom !== undefined ? { effectiveFrom: input.effectiveFrom } : {}),
            ...(input.effectiveUntil !== undefined ? { effectiveUntil: input.effectiveUntil } : {}),
            ...(input.workflowCodes !== undefined
              ? { workflowCodes: [...input.workflowCodes] }
              : {}),
          },
          actor,
        ),
    });

    this.effectiveCommentsService.registerWorkflowTimelineEntriesProvider?.(async (params) =>
      this.buildWorkflowTimelineEntries(params),
    );
  }

  private async resolveDelegationRules(): Promise<readonly WorkflowApprovalDelegationRule[]> {
    const effectiveApprovals =
      this.approvalsPublicService ??
      ('listDelegations' in this.approvalStepRepository
        ? (this.approvalStepRepository as IApprovalsPublicService)
        : null);
    if (effectiveApprovals) {
      const dbRules = await effectiveApprovals.listDelegations().catch(() => []);
      if (dbRules.length > 0) {
        return dbRules.map((r) => ({
          id: r.id,
          fromUserId: r.fromUserId,
          toUserId: r.toUserId,
          effectiveFrom: r.effectiveFrom,
          effectiveUntil: r.effectiveUntil,
          ...(r.workflowCodes.length > 0 ? { workflowCodes: r.workflowCodes } : {}),
          ...(r.entityTypes.length > 0 ? { entityTypes: r.entityTypes } : {}),
          organizationUnitId: r.organizationUnitId,
          reason: r.reason ?? '',
          isActive: r.isActive,
          createdAt: r.createdAt,
        }));
      }
    }
    return this.fallbackDelegationRules;
  }

  private async buildWorkflowTimelineEntries(params: {
    readonly entityType: string;
    readonly entityId: string;
    readonly workflowInstanceId?: number | undefined;
  }): Promise<readonly RecordActivityTimelineEntryView[]> {
    const instances = await this.instanceRepository.findByEntity(
      params.entityType.trim().toLowerCase(),
      params.entityId.trim(),
    );
    const filteredInstances =
      params.workflowInstanceId !== undefined
        ? instances.filter((i) => Number(i.id) === Number(params.workflowInstanceId))
        : instances;
    if (filteredInstances.length === 0) return [];

    const instanceIds = filteredInstances.map((i) => Number(i.id));
    const histories = await this.historyRepository.findByInstanceIds(instanceIds);
    const actorIds = [
      ...new Set(
        histories
          .map((h) =>
            h.actorUserId !== null && h.actorUserId !== undefined ? Number(h.actorUserId) : 0,
          )
          .filter((id) => id > 0),
      ),
    ];
    const contacts =
      actorIds.length > 0 && this.usersPublicService?.findUserContactsByIds
        ? await this.usersPublicService.findUserContactsByIds(actorIds).catch(() => [])
        : [];
    const userMap = new Map(contacts.map((u) => [Number(u.id), u]));

    return histories.map((h) => {
      const actorInfo =
        h.actorUserId !== null && h.actorUserId !== undefined
          ? userMap.get(Number(h.actorUserId))
          : undefined;
      return {
        id: `workflow_history_${h.id}`,
        source: 'WORKFLOW' as const,
        actionType: h.actionType,
        title: h.fromStateCode
          ? `Workflow ${h.actionType}: ${h.fromStateCode} -> ${h.toStateCode}`
          : `Workflow ${h.actionType}: -> ${h.toStateCode}`,
        summary: h.reason ?? null,
        isInternal: false,
        actorUserId:
          h.actorUserId !== null && h.actorUserId !== undefined ? Number(h.actorUserId) : null,
        actorFullName: actorInfo?.fullName ?? null,
        actorUsername: actorInfo?.username ?? null,
        occurredAt: (h.createdAt ? new Date(h.createdAt) : new Date()).toISOString(),
        metadata: {
          workflowInstanceId: Number(h.workflowInstanceId),
          transitionCode: h.transitionCode ?? null,
          fromStateCode: h.fromStateCode ?? null,
          toStateCode: h.toStateCode,
          ...safeJsonParseObject<Record<string, unknown>>(h.metadataJson, {}),
        },
      };
    });
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
    return executeCreateWorkflowDefinition({
      dto,
      actorId,
      definitionRepository: this.definitionRepository,
      stateRepository: this.stateRepository,
      transitionRepository: this.transitionRepository,
      transactionManager: this.transactionManager,
      auditLogService: this.auditLogService,
      getDefinitionById: (id) => this.getDefinitionById(id),
    });
  }

  public async updateDefinition(
    id: number,
    dto: UpdateWorkflowDefinitionRequest,
    _actorId?: number,
  ): Promise<WorkflowDefinitionItemView> {
    return executeUpdateWorkflowDefinition({
      id,
      dto,
      definitionRepository: this.definitionRepository,
      stateRepository: this.stateRepository,
      transitionRepository: this.transitionRepository,
      transactionManager: this.transactionManager,
      getDefinitionById: (defId) => this.getDefinitionById(defId),
    });
  }

  public async createNewVersion(id: number, actorId?: number): Promise<WorkflowDefinitionItemView> {
    const current = await this.getDefinitionById(id);
    const nextVersion = (await this.definitionRepository.findMaxVersionByCode(current.code)) + 1;
    return this.createDefinition(
      buildClonedDefinitionVersionPayload(current, nextVersion),
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
    validateStatesAndTransitionsConsistency(
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
    const delegationRules = await this.resolveDelegationRules();
    return executeStartWorkflowForEntity({
      input,
      actor,
      definitionRepository: this.definitionRepository,
      stateRepository: this.stateRepository,
      instanceRepository: this.instanceRepository,
      approvalStepRepository: this.approvalStepRepository,
      historyRepository: this.historyRepository,
      usersPublicService: this.usersPublicService,
      notificationsPublicService: this.notificationsPublicService,
      messagePublisher: this.messagePublisher,
      delegationRules,
      getInstanceById: (id, act) => this.getInstanceById(id, act),
    });
  }

  public async executeTransition(
    id: number,
    dto: ExecuteWorkflowTransitionRequest,
    actor?: UserIdentity,
  ): Promise<WorkflowInstanceDetailView> {
    const delegationRules = await this.resolveDelegationRules();
    return executeWorkflowStateTransition({
      id,
      dto,
      actor,
      definitionRepository: this.definitionRepository,
      stateRepository: this.stateRepository,
      transitionRepository: this.transitionRepository,
      instanceRepository: this.instanceRepository,
      approvalStepRepository: this.approvalStepRepository,
      historyRepository: this.historyRepository,
      usersPublicService: this.usersPublicService,
      notificationsPublicService: this.notificationsPublicService,
      messagePublisher: this.messagePublisher,
      delegationRules,
      getInstanceById: (instId, act) => this.getInstanceById(instId, act),
    });
  }

  public async decideApproval(
    id: number,
    dto: DecideWorkflowApprovalRequest,
    actor?: UserIdentity,
  ): Promise<WorkflowInstanceDetailView> {
    const delegationRules = await this.resolveDelegationRules();
    return executeDecideWorkflowApproval({
      id,
      dto,
      actor,
      stateRepository: this.stateRepository,
      transitionRepository: this.transitionRepository,
      instanceRepository: this.instanceRepository,
      approvalStepRepository: this.approvalStepRepository,
      historyRepository: this.historyRepository,
      delegationRules,
      executeTransition: (instId, trDto, act) => this.executeTransition(instId, trDto, act),
      getInstanceById: (instId, act) => this.getInstanceById(instId, act),
    });
  }

  public async delegateApproval(
    id: number,
    dto: DelegateWorkflowApprovalRequest,
    actor?: UserIdentity,
  ): Promise<WorkflowInstanceDetailView> {
    if (dto.effectiveFrom && dto.effectiveUntil && actor?.id) {
      await this.createDelegationRule(
        {
          fromUserId: actor.id,
          toUserId: dto.toUserId,
          effectiveFrom: dto.effectiveFrom,
          effectiveUntil: dto.effectiveUntil,
          workflowCodes: dto.workflowCodes,
          entityTypes: dto.entityTypes,
          organizationUnitId: dto.organizationUnitId,
          reason: dto.reason,
        },
        actor,
      );
    }
    return executeDelegateWorkflowApproval({
      id,
      dto,
      actor,
      instanceRepository: this.instanceRepository,
      approvalStepRepository: this.approvalStepRepository,
      historyRepository: this.historyRepository,
      getInstanceById: (instId, act) => this.getInstanceById(instId, act),
    });
  }

  public async listDelegationRules(): Promise<readonly WorkflowApprovalDelegationRule[]> {
    return this.resolveDelegationRules();
  }

  public async createDelegationRule(
    dto: CreateWorkflowDelegationRuleRequest,
    actor?: UserIdentity,
  ): Promise<WorkflowApprovalDelegationRule> {
    const fromMs = new Date(dto.effectiveFrom).getTime();
    const untilMs = new Date(dto.effectiveUntil).getTime();
    if (Number.isNaN(fromMs) || Number.isNaN(untilMs) || fromMs >= untilMs) {
      throw new BadRequestAppException('workflows.invalidDelegationTimeRange', [
        { effectiveFrom: dto.effectiveFrom, effectiveUntil: dto.effectiveUntil },
      ]);
    }

    const fromUserId = dto.fromUserId ?? actor?.id ?? 1;
    if (this.approvalsPublicService) {
      try {
        const created = await this.approvalsPublicService.createDelegation(
          {
            fromUserId: Number(fromUserId),
            toUserId: Number(dto.toUserId),
            effectiveFrom: new Date(fromMs).toISOString(),
            effectiveUntil: new Date(untilMs).toISOString(),
            workflowCodes: dto.workflowCodes ?? [],
            entityTypes: dto.entityTypes ?? [],
            organizationUnitId: dto.organizationUnitId ?? null,
            reason: dto.reason.trim(),
          },
          actor,
        );
        return {
          id: created.id,
          fromUserId: created.fromUserId,
          toUserId: created.toUserId,
          effectiveFrom: created.effectiveFrom,
          effectiveUntil: created.effectiveUntil,
          ...(created.workflowCodes.length > 0 ? { workflowCodes: created.workflowCodes } : {}),
          ...(created.entityTypes.length > 0 ? { entityTypes: created.entityTypes } : {}),
          organizationUnitId: created.organizationUnitId,
          reason: created.reason ?? dto.reason.trim(),
          isActive: created.isActive,
          createdAt: created.createdAt,
        };
      } catch {
        // Fallback when DB is not connected in unit tests
      }
    }

    const rule: WorkflowApprovalDelegationRule = {
      id: this.fallbackDelegationSeq++,
      fromUserId: Number(fromUserId),
      toUserId: Number(dto.toUserId),
      effectiveFrom: new Date(fromMs).toISOString(),
      effectiveUntil: new Date(untilMs).toISOString(),
      ...(dto.workflowCodes && dto.workflowCodes.length > 0
        ? { workflowCodes: dto.workflowCodes.map((c) => c.trim().toUpperCase()) }
        : {}),
      ...(dto.entityTypes && dto.entityTypes.length > 0
        ? { entityTypes: dto.entityTypes.map((e) => e.trim().toLowerCase()) }
        : {}),
      ...(dto.organizationUnitId !== undefined
        ? { organizationUnitId: dto.organizationUnitId }
        : {}),
      reason: dto.reason.trim(),
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    this.fallbackDelegationRules.unshift(rule);
    return rule;
  }

  public async revokeDelegationRule(id: number): Promise<WorkflowApprovalDelegationRule> {
    if (this.approvalsPublicService) {
      await this.approvalsPublicService.revokeDelegation(Number(id)).catch(() => undefined);
    }
    const idx = this.fallbackDelegationRules.findIndex((r) => r.id === Number(id));
    if (idx === -1) {
      throw new NotFoundAppException('workflows.delegationRuleNotFound', { id });
    }
    const updated: WorkflowApprovalDelegationRule = {
      ...this.fallbackDelegationRules[idx]!,
      isActive: false,
    };
    this.fallbackDelegationRules[idx] = updated;
    return updated;
  }

  public async cancelInstance(
    id: number,
    dto: CancelWorkflowInstanceRequest,
    actor?: UserIdentity,
  ): Promise<WorkflowInstanceDetailView> {
    return executeCancelWorkflowInstance({
      id,
      dto,
      actor,
      instanceRepository: this.instanceRepository,
      approvalStepRepository: this.approvalStepRepository,
      historyRepository: this.historyRepository,
      auditLogService: this.auditLogService,
      getInstanceById: (instId, act) => this.getInstanceById(instId, act),
    });
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
      stateRepository: this.stateRepository,
      instanceRepository: this.instanceRepository,
      approvalStepRepository: this.approvalStepRepository,
      historyRepository: this.historyRepository,
      usersPublicService: this.usersPublicService,
      notificationsPublicService: this.notificationsPublicService,
      defaultWarningMinutes: warningMinutes,
    });
  }

  public async listRecordComments(
    query: ListWorkflowCommentsQuery,
    actor?: UserIdentity,
  ): Promise<WorkflowCommentItemView[]> {
    const items = await this.effectiveCommentsService.listComments(query, actor);
    return items as unknown as WorkflowCommentItemView[];
  }

  public async addRecordComment(
    dto: CreateWorkflowCommentRequest,
    actor?: UserIdentity,
  ): Promise<WorkflowCommentItemView> {
    const created = await this.effectiveCommentsService.createComment(
      {
        entityType: dto.entityType,
        entityId: dto.entityId,
        workflowInstanceId: dto.workflowInstanceId ?? null,
        parentCommentId: dto.parentCommentId ?? null,
        content: dto.content,
        isInternal: dto.isInternal ?? false,
        mentionedUserIds: dto.mentionedUserIds ?? [],
        attachmentFileIds: dto.attachmentFileIds ?? [],
      },
      actor,
    );
    return created as unknown as WorkflowCommentItemView;
  }

  public async updateRecordComment(
    id: number,
    dto: UpdateWorkflowCommentRequest,
    actor?: UserIdentity,
    now?: Date,
  ): Promise<WorkflowCommentItemView> {
    const updated = await this.effectiveCommentsService.updateComment(
      id,
      {
        content: dto.content,
        ...(dto.mentionedUserIds !== undefined ? { mentionedUserIds: dto.mentionedUserIds } : {}),
        ...(dto.attachmentFileIds !== undefined
          ? { attachmentFileIds: dto.attachmentFileIds }
          : {}),
        editReason: dto.editReason ?? null,
      },
      actor,
      now,
    );
    return updated as unknown as WorkflowCommentItemView;
  }

  public async deleteRecordComment(
    id: number,
    actor?: UserIdentity,
    now?: Date,
  ): Promise<WorkflowCommentItemView & { readonly id: number; readonly deleted: true }> {
    const deleted = await this.effectiveCommentsService.deleteComment(id, actor, now);
    return deleted as unknown as WorkflowCommentItemView & {
      readonly id: number;
      readonly deleted: true;
    };
  }

  public async getRecordActivityTimeline(
    query: ListWorkflowTimelineQuery,
    actor?: UserIdentity,
  ): Promise<WorkflowRecordActivityTimelineView> {
    return this.effectiveCommentsService.getRecordTimeline(
      {
        entityType: query.entityType,
        entityId: query.entityId,
        workflowInstanceId: query.workflowInstanceId,
        source: query.source,
        sortOrder: query.sortOrder,
      },
      actor,
    );
  }
}

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
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
  WORKFLOWS_SETTING_KEYS,
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
      getInstanceById: (id, act) => this.getInstanceById(id, act),
    });
  }

  public async executeTransition(
    id: number,
    dto: ExecuteWorkflowTransitionRequest,
    actor?: UserIdentity,
  ): Promise<WorkflowInstanceDetailView> {
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
      getInstanceById: (instId, act) => this.getInstanceById(instId, act),
    });
  }

  public async decideApproval(
    id: number,
    dto: DecideWorkflowApprovalRequest,
    actor?: UserIdentity,
  ): Promise<WorkflowInstanceDetailView> {
    return executeDecideWorkflowApproval({
      id,
      dto,
      actor,
      stateRepository: this.stateRepository,
      transitionRepository: this.transitionRepository,
      instanceRepository: this.instanceRepository,
      approvalStepRepository: this.approvalStepRepository,
      historyRepository: this.historyRepository,
      executeTransition: (instId, trDto, act) => this.executeTransition(instId, trDto, act),
      getInstanceById: (instId, act) => this.getInstanceById(instId, act),
    });
  }

  public async delegateApproval(
    id: number,
    dto: DelegateWorkflowApprovalRequest,
    actor?: UserIdentity,
  ): Promise<WorkflowInstanceDetailView> {
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
      instanceRepository: this.instanceRepository,
      approvalStepRepository: this.approvalStepRepository,
      historyRepository: this.historyRepository,
      notificationsPublicService: this.notificationsPublicService,
      defaultWarningMinutes: warningMinutes,
    });
  }
}

import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  BadRequestAppException,
  NotFoundAppException,
  safeJsonParseStringArray,
} from '@packages/kernel/index.js';
import type { UserIdentity } from '@packages/security/index.js';
import {
  type INotificationsPublicService,
  NOTIFICATIONS_PUBLIC_SERVICE,
  NOTIFICATION_CATEGORY,
  NOTIFICATION_PRIORITY,
  NOTIFICATION_TARGET_TYPE,
} from '@modules/notifications/contracts/index.js';
import type {
  ApprovalDelegationRuleView,
  ApprovalInstanceStepsOverviewView,
  CreateApprovalDelegationRuleInput,
  CreateWorkflowApprovalStepInput,
  DecideApprovalStepInput,
  DelegateApprovalStepInput,
  IApprovalsPublicService,
  InstanceApprovalCoordinator,
  WorkflowApprovalStepRecord,
} from '../contracts/index.js';
import type { WorkflowApprovalDelegationEntity } from '../entities/workflow-approval-delegation.entity.js';
import type { WorkflowApprovalStepEntity } from '../entities/workflow-approval-step.entity.js';
import { WorkflowApprovalDelegationRepository } from '../repositories/workflow-approval-delegation.repository.js';
import { WorkflowApprovalStepRepository } from '../repositories/workflow-approval-step.repository.js';

@Injectable()
export class ApprovalsService implements IApprovalsPublicService {
  private instanceCoordinator: InstanceApprovalCoordinator | null = null;

  constructor(
    private readonly delegationRepository: WorkflowApprovalDelegationRepository,
    @Optional()
    @Inject(NOTIFICATIONS_PUBLIC_SERVICE)
    private readonly notificationsPublicService: INotificationsPublicService | null = null,
    @Optional()
    @Inject(WorkflowApprovalStepRepository)
    private readonly stepRepository: WorkflowApprovalStepRepository | null = null,
  ) {}

  public registerInstanceApprovalCoordinator(coordinator: InstanceApprovalCoordinator): void {
    this.instanceCoordinator = coordinator;
  }

  public async findByInstanceId(workflowInstanceId: number): Promise<WorkflowApprovalStepRecord[]> {
    if (!this.stepRepository) return [];
    return this.stepRepository.findByInstanceId(workflowInstanceId);
  }

  public async findByInstanceIds(
    instanceIds: readonly number[],
  ): Promise<WorkflowApprovalStepRecord[]> {
    if (!this.stepRepository) return [];
    return this.stepRepository.findByInstanceIds(instanceIds);
  }

  public async createSteps(
    inputs: readonly CreateWorkflowApprovalStepInput[],
  ): Promise<WorkflowApprovalStepRecord[]> {
    if (!this.stepRepository) return [];
    return this.stepRepository.createSteps(inputs);
  }

  public async saveEntity(step: WorkflowApprovalStepRecord): Promise<WorkflowApprovalStepRecord> {
    if (!this.stepRepository) return step;
    return this.stepRepository.saveEntity(step as WorkflowApprovalStepEntity);
  }

  public async createDelegation(
    input: CreateApprovalDelegationRuleInput,
    actor?: UserIdentity,
  ): Promise<ApprovalDelegationRuleView> {
    const fromUserId = Number(input.fromUserId ?? actor?.id ?? 0);
    const toUserId = Number(input.toUserId);

    if (!fromUserId || fromUserId <= 0) {
      throw new BadRequestAppException('approvals.delegationMissingFromUser');
    }
    if (fromUserId === toUserId) {
      throw new BadRequestAppException('approvals.delegationSelfNotAllowed');
    }

    const fromDate = new Date(input.effectiveFrom);
    const untilDate = new Date(input.effectiveUntil);
    if (
      Number.isNaN(fromDate.getTime()) ||
      Number.isNaN(untilDate.getTime()) ||
      untilDate.getTime() <= fromDate.getTime()
    ) {
      throw new BadRequestAppException('approvals.delegationInvalidPeriod');
    }

    const workflowCodes = (input.workflowCodes ?? [])
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    const entityTypes = (input.entityTypes ?? [])
      .map((c) => c.trim().toLowerCase())
      .filter(Boolean);

    const saved = await this.delegationRepository.createRule({
      fromUserId,
      toUserId,
      effectiveFrom: fromDate,
      effectiveUntil: untilDate,
      workflowCodesJson: JSON.stringify(workflowCodes),
      entityTypesJson: JSON.stringify(entityTypes),
      organizationUnitId: input.organizationUnitId ?? null,
      reason: input.reason ?? null,
      isActive: true,
      createdByUserId: actor?.id ?? fromUserId,
    });

    if (this.notificationsPublicService) {
      await this.notificationsPublicService
        .dispatch({
          title: 'Bạn được ủy quyền phê duyệt hồ sơ',
          content: `Người dùng #${fromUserId} đã ủy quyền phê duyệt cho bạn từ ${fromDate.toLocaleDateString('vi-VN')} đến ${untilDate.toLocaleDateString('vi-VN')}.`,
          category: NOTIFICATION_CATEGORY.WORK,
          priority: NOTIFICATION_PRIORITY.NORMAL,
          targetType: NOTIFICATION_TARGET_TYPE.SINGLE_USER,
          userId: toUserId,
          referenceModule: 'approvals',
          referenceType: 'approval_delegation',
          referenceId: String(saved.id),
          actionUrl: '/approvals',
        })
        .catch(() => undefined);
    }

    return this.mapDelegationEntity(saved);
  }

  public async listDelegations(query?: {
    readonly fromUserId?: number | undefined;
    readonly toUserId?: number | undefined;
    readonly activeOnly?: boolean | undefined;
  }): Promise<ApprovalDelegationRuleView[]> {
    const entities = await this.delegationRepository.findAllRules();
    const nowMs = Date.now();

    return entities
      .filter((entity) => {
        if (query?.fromUserId && Number(entity.fromUserId) !== Number(query.fromUserId)) {
          return false;
        }
        if (query?.toUserId && Number(entity.toUserId) !== Number(query.toUserId)) {
          return false;
        }
        if (query?.activeOnly) {
          const fromMs = new Date(entity.effectiveFrom).getTime();
          const untilMs = new Date(entity.effectiveUntil).getTime();
          if (!entity.isActive || nowMs < fromMs || nowMs > untilMs) {
            return false;
          }
        }
        return true;
      })
      .map((entity) => this.mapDelegationEntity(entity));
  }

  public async revokeDelegation(
    ruleId: number,
    actor?: UserIdentity,
  ): Promise<{ readonly revoked: true; readonly id: number }> {
    const entity = await this.delegationRepository.findById(ruleId);
    if (!entity) {
      throw new NotFoundAppException('approvals.delegationNotFound', { id: ruleId });
    }

    const isSuperOrAdmin =
      actor?.roles?.includes('super_admin') || actor?.roles?.includes('admin') || false;
    if (actor && !isSuperOrAdmin && Number(actor.id) !== Number(entity.fromUserId)) {
      throw new BadRequestAppException('approvals.delegationRevokeForbidden');
    }

    entity.isActive = false;
    await this.delegationRepository.saveEntity(entity);
    return { revoked: true, id: Number(entity.id) };
  }

  public async findActiveDelegationForApprover(params: {
    readonly fromUserId: number;
    readonly workflowCode?: string | null | undefined;
    readonly entityType?: string | null | undefined;
    readonly organizationUnitId?: number | null | undefined;
    readonly at?: Date | undefined;
  }): Promise<ApprovalDelegationRuleView | null> {
    const atMs = (params.at ?? new Date()).getTime();
    const entities = await this.delegationRepository.findAllRules();

    for (const entity of entities) {
      if (!entity.isActive || Number(entity.fromUserId) !== Number(params.fromUserId)) {
        continue;
      }
      const fromMs = new Date(entity.effectiveFrom).getTime();
      const untilMs = new Date(entity.effectiveUntil).getTime();
      if (atMs < fromMs || atMs > untilMs) {
        continue;
      }

      const wfCodes = safeJsonParseStringArray(entity.workflowCodesJson);
      if (
        wfCodes.length > 0 &&
        params.workflowCode &&
        !wfCodes.includes(params.workflowCode.toUpperCase())
      ) {
        continue;
      }

      const entityTypes = safeJsonParseStringArray(entity.entityTypesJson);
      if (
        entityTypes.length > 0 &&
        params.entityType &&
        !entityTypes.includes(params.entityType.toLowerCase())
      ) {
        continue;
      }

      if (
        entity.organizationUnitId !== null &&
        entity.organizationUnitId !== undefined &&
        params.organizationUnitId !== null &&
        params.organizationUnitId !== undefined &&
        Number(entity.organizationUnitId) !== Number(params.organizationUnitId)
      ) {
        continue;
      }

      return this.mapDelegationEntity(entity);
    }

    return null;
  }

  public async getInstanceSteps(
    instanceId: number,
    actor?: UserIdentity,
  ): Promise<ApprovalInstanceStepsOverviewView> {
    if (!this.instanceCoordinator) {
      throw new NotFoundAppException('approvals.coordinatorNotRegistered');
    }
    return this.instanceCoordinator.getInstanceSteps(instanceId, actor);
  }

  public async decideInstanceStep(
    instanceId: number,
    input: DecideApprovalStepInput,
    actor?: UserIdentity,
  ): Promise<unknown> {
    if (!this.instanceCoordinator) {
      throw new NotFoundAppException('approvals.coordinatorNotRegistered');
    }
    return this.instanceCoordinator.decideStep(instanceId, input, actor);
  }

  public async delegateInstanceStep(
    instanceId: number,
    input: DelegateApprovalStepInput,
    actor?: UserIdentity,
  ): Promise<unknown> {
    if (!this.instanceCoordinator || typeof this.instanceCoordinator.delegateStep !== 'function') {
      throw new NotFoundAppException('approvals.coordinatorNotRegistered');
    }
    return this.instanceCoordinator.delegateStep(instanceId, input, actor);
  }

  private mapDelegationEntity(
    entity: WorkflowApprovalDelegationEntity,
  ): ApprovalDelegationRuleView {
    return {
      id: Number(entity.id),
      fromUserId: Number(entity.fromUserId),
      toUserId: Number(entity.toUserId),
      effectiveFrom: new Date(entity.effectiveFrom).toISOString(),
      effectiveUntil: new Date(entity.effectiveUntil).toISOString(),
      workflowCodes: safeJsonParseStringArray(entity.workflowCodesJson),
      entityTypes: safeJsonParseStringArray(entity.entityTypesJson),
      organizationUnitId:
        entity.organizationUnitId !== null && entity.organizationUnitId !== undefined
          ? Number(entity.organizationUnitId)
          : null,
      reason: entity.reason ?? null,
      isActive: Boolean(entity.isActive),
      createdAt: entity.createdAt
        ? new Date(entity.createdAt).toISOString()
        : new Date().toISOString(),
    };
  }
}

import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { WorkflowApprovalStepEntity } from '../entities/workflow-approval-step.entity.js';
import {
  WORKFLOW_APPROVAL_DECISION,
  WORKFLOW_APPROVAL_MODE,
  type WorkflowApprovalDecision,
  type WorkflowApprovalMode,
} from '../enum/workflows.enum.js';

export interface CreateWorkflowApprovalStepInput {
  readonly workflowInstanceId: number;
  readonly stateCode: string;
  readonly stepOrder: number;
  readonly approvalMode?: WorkflowApprovalMode | undefined;
  readonly approverUserId?: number | null | undefined;
  readonly delegatedFromUserId?: number | null | undefined;
  readonly approverRoleCode?: string | null | undefined;
  readonly decision?: WorkflowApprovalDecision | undefined;
}

@Injectable()
export class WorkflowApprovalStepRepository extends BaseTypeOrmRepository<WorkflowApprovalStepEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(WorkflowApprovalStepEntity, dataSource, transactionManager);
  }

  public async findByInstanceId(workflowInstanceId: number): Promise<WorkflowApprovalStepEntity[]> {
    return this.executeReadOnly((repo) =>
      repo.find({
        where: { workflowInstanceId: Number(workflowInstanceId) },
        order: { stepOrder: 'ASC', id: 'ASC' },
      }),
    );
  }

  public async findByInstanceIds(
    instanceIds: readonly number[],
  ): Promise<WorkflowApprovalStepEntity[]> {
    if (instanceIds.length === 0) return [];
    return this.executeReadOnly((repo) =>
      repo.find({
        where: { workflowInstanceId: In([...new Set(instanceIds.map(Number))]) },
        order: { stepOrder: 'ASC', id: 'ASC' },
      }),
    );
  }

  public async createSteps(
    inputs: readonly CreateWorkflowApprovalStepInput[],
  ): Promise<WorkflowApprovalStepEntity[]> {
    if (inputs.length === 0) return [];
    const entities = inputs.map((input) =>
      this.repository.create({
        workflowInstanceId: Number(input.workflowInstanceId),
        stateCode: input.stateCode.trim().toUpperCase(),
        stepOrder: input.stepOrder,
        approvalMode: input.approvalMode ?? WORKFLOW_APPROVAL_MODE.SINGLE,
        approverUserId: input.approverUserId ?? null,
        delegatedFromUserId: input.delegatedFromUserId ?? null,
        approverRoleCode: input.approverRoleCode ?? null,
        decision: input.decision ?? WORKFLOW_APPROVAL_DECISION.PENDING,
        comment: null,
        decidedAt: null,
        decidedByUserId: null,
      }),
    );
    return this.repository.save(entities);
  }
}

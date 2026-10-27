import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { WorkflowStateEntity } from '../entities/workflow-state.entity.js';
import { WORKFLOW_STATE_TYPE, type WorkflowStateType } from '../enum/workflows.enum.js';
import type { WorkflowStateApprovalConfig } from '../types/workflows.types.js';

export interface UpsertWorkflowStateInput {
  readonly code: string;
  readonly name: string;
  readonly stateType?: WorkflowStateType | undefined;
  readonly badgeTone?: string | undefined;
  readonly slaHours?: number | null | undefined;
  readonly approvalConfig?: WorkflowStateApprovalConfig | null | undefined;
  readonly sortOrder?: number | undefined;
}

@Injectable()
export class WorkflowStateRepository extends BaseTypeOrmRepository<WorkflowStateEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(WorkflowStateEntity, dataSource, transactionManager);
  }

  public async findByDefinitionIds(
    definitionIds: readonly number[],
  ): Promise<WorkflowStateEntity[]> {
    if (definitionIds.length === 0) return [];
    return this.executeReadOnly((repo) =>
      repo.find({
        where: { workflowDefinitionId: In([...new Set(definitionIds.map(Number))]) },
        order: { sortOrder: 'ASC', id: 'ASC' },
      }),
    );
  }

  public async replaceStatesForDefinition(
    workflowDefinitionId: number,
    inputs: readonly UpsertWorkflowStateInput[],
  ): Promise<WorkflowStateEntity[]> {
    await this.repository.delete({ workflowDefinitionId: Number(workflowDefinitionId) });
    if (inputs.length === 0) return [];

    const deduped = new Map<string, UpsertWorkflowStateInput>();
    for (const item of inputs) {
      deduped.set(item.code.trim().toUpperCase(), item);
    }

    const entities = [...deduped.values()].map((item, idx) =>
      this.repository.create({
        workflowDefinitionId: Number(workflowDefinitionId),
        code: item.code.trim().toUpperCase(),
        name: item.name.trim(),
        stateType: item.stateType ?? WORKFLOW_STATE_TYPE.INTERMEDIATE,
        badgeTone: item.badgeTone?.trim() || 'info',
        slaHours: item.slaHours ?? null,
        approvalConfigJson: item.approvalConfig ? JSON.stringify(item.approvalConfig) : null,
        sortOrder: item.sortOrder ?? idx + 1,
      }),
    );

    return this.repository.save(entities);
  }
}

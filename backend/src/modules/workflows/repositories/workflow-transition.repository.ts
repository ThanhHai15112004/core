import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { WorkflowTransitionEntity } from '../entities/workflow-transition.entity.js';
import type {
  WorkflowTransitionActionConfig,
  WorkflowTransitionConditions,
} from '../types/workflows.types.js';

export interface UpsertWorkflowTransitionInput {
  readonly code: string;
  readonly name: string;
  readonly fromStateCode: string;
  readonly toStateCode: string;
  readonly conditions?: WorkflowTransitionConditions | null | undefined;
  readonly actions?: readonly WorkflowTransitionActionConfig[] | null | undefined;
  readonly sortOrder?: number | undefined;
}

@Injectable()
export class WorkflowTransitionRepository extends BaseTypeOrmRepository<WorkflowTransitionEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(WorkflowTransitionEntity, dataSource, transactionManager);
  }

  public async findByDefinitionIds(
    definitionIds: readonly number[],
  ): Promise<WorkflowTransitionEntity[]> {
    if (definitionIds.length === 0) return [];
    return this.executeReadOnly((repo) =>
      repo.find({
        where: { workflowDefinitionId: In([...new Set(definitionIds.map(Number))]) },
        order: { sortOrder: 'ASC', id: 'ASC' },
      }),
    );
  }

  public async replaceTransitionsForDefinition(
    workflowDefinitionId: number,
    inputs: readonly UpsertWorkflowTransitionInput[],
  ): Promise<WorkflowTransitionEntity[]> {
    await this.repository.delete({ workflowDefinitionId: Number(workflowDefinitionId) });
    if (inputs.length === 0) return [];

    const entities = inputs.map((item, idx) =>
      this.repository.create({
        workflowDefinitionId: Number(workflowDefinitionId),
        code: item.code.trim().toUpperCase(),
        name: item.name.trim(),
        fromStateCode: item.fromStateCode.trim().toUpperCase(),
        toStateCode: item.toStateCode.trim().toUpperCase(),
        conditionsJson: item.conditions ? JSON.stringify(item.conditions) : null,
        actionsJson: item.actions ? JSON.stringify(item.actions) : null,
        sortOrder: item.sortOrder ?? idx + 1,
      }),
    );

    return this.repository.save(entities);
  }
}

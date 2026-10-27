import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { WorkflowHistoryEntity } from '../entities/workflow-history.entity.js';
import {
  WORKFLOW_HISTORY_ACTION_TYPE,
  type WorkflowHistoryActionType,
} from '../enum/workflows.enum.js';
import type { WorkflowTriggeredActionResult } from '../types/workflows.types.js';

export interface RecordWorkflowHistoryInput {
  readonly workflowInstanceId: number;
  readonly transitionCode?: string | null | undefined;
  readonly actionType?: WorkflowHistoryActionType | undefined;
  readonly fromStateCode?: string | null | undefined;
  readonly toStateCode: string;
  readonly actorUserId?: number | null | undefined;
  readonly reason?: string | null | undefined;
  readonly triggeredActions?: readonly WorkflowTriggeredActionResult[] | undefined;
  readonly metadata?: Record<string, unknown> | null | undefined;
}

@Injectable()
export class WorkflowHistoryRepository extends BaseTypeOrmRepository<WorkflowHistoryEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(WorkflowHistoryEntity, dataSource, transactionManager);
  }

  public async findByInstanceId(workflowInstanceId: number): Promise<WorkflowHistoryEntity[]> {
    return this.executeReadOnly((repo) =>
      repo.find({
        where: { workflowInstanceId: Number(workflowInstanceId) },
        order: { id: 'ASC' },
      }),
    );
  }

  public async recordHistory(input: RecordWorkflowHistoryInput): Promise<WorkflowHistoryEntity> {
    const entity = this.repository.create({
      workflowInstanceId: Number(input.workflowInstanceId),
      transitionCode: input.transitionCode ?? null,
      actionType: input.actionType ?? WORKFLOW_HISTORY_ACTION_TYPE.TRANSITION,
      fromStateCode: input.fromStateCode ?? null,
      toStateCode: input.toStateCode.trim().toUpperCase(),
      actorUserId: input.actorUserId ?? null,
      reason: input.reason ?? null,
      triggeredActionsJson: input.triggeredActions ? JSON.stringify(input.triggeredActions) : null,
      metadataJson: input.metadata ? JSON.stringify(input.metadata) : null,
    });
    return this.repository.save(entity);
  }
}

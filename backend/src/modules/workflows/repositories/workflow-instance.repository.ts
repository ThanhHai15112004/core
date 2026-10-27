import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { CountMode } from '@packages/kernel/index.js';
import {
  BaseTypeOrmRepository,
  type DataScopeQueryFilterInput,
  TransactionManager,
} from '@packages/database/index.js';
import { WorkflowInstanceEntity } from '../entities/workflow-instance.entity.js';
import {
  WORKFLOW_INSTANCE_STATUS,
  type WorkflowInstanceStatusCode,
} from '../enum/workflows.enum.js';

export interface SearchWorkflowInstancesFilter {
  readonly search?: string | undefined;
  readonly workflowCode?: string | undefined;
  readonly entityType?: string | undefined;
  readonly entityId?: string | undefined;
  readonly currentStateCode?: string | undefined;
  readonly status?: WorkflowInstanceStatusCode | undefined;
  readonly isOverdue?: boolean | undefined;
  readonly initiatorUserId?: number | undefined;
  readonly organizationUnitId?: number | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: CountMode | undefined;
  readonly scopeFilter?: DataScopeQueryFilterInput | undefined;
}

@Injectable()
export class WorkflowInstanceRepository extends BaseTypeOrmRepository<WorkflowInstanceEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(WorkflowInstanceEntity, dataSource, transactionManager);
  }

  public override async findById(id: number): Promise<WorkflowInstanceEntity | null> {
    return this.executeReadOnly((repo) => repo.findOne({ where: { id: Number(id) } }));
  }

  public async findByEntity(
    entityType: string,
    entityId: string,
  ): Promise<WorkflowInstanceEntity[]> {
    return this.executeReadOnly((repo) =>
      repo.find({
        where: {
          entityType: entityType.trim().toLowerCase(),
          entityId: entityId.trim(),
        },
        order: { id: 'DESC' },
      }),
    );
  }

  public async findRunningInstancesWithDueDate(): Promise<WorkflowInstanceEntity[]> {
    return this.executeReadOnly((repo) =>
      repo
        .createQueryBuilder('i')
        .where('i.status = :status', { status: WORKFLOW_INSTANCE_STATUS.RUNNING })
        .andWhere('i.due_at IS NOT NULL')
        .orderBy('i.due_at', 'ASC')
        .getMany(),
    );
  }

  public async searchPaginated(filter: SearchWorkflowInstancesFilter = {}): Promise<{
    readonly items: WorkflowInstanceEntity[];
    readonly total: number;
  }> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo.createQueryBuilder('i');

      if (filter.search?.trim()) {
        const q = `%${filter.search.trim().toLowerCase()}%`;
        qb.andWhere(
          '(LOWER(i.title) LIKE :q OR LOWER(i.entity_id) LIKE :q OR LOWER(i.workflow_code) LIKE :q)',
          { q },
        );
      }
      if (filter.workflowCode?.trim()) {
        qb.andWhere('UPPER(i.workflow_code) = :workflowCode', {
          workflowCode: filter.workflowCode.trim().toUpperCase(),
        });
      }
      if (filter.entityType?.trim()) {
        qb.andWhere('LOWER(i.entity_type) = :entityType', {
          entityType: filter.entityType.trim().toLowerCase(),
        });
      }
      if (filter.entityId?.trim()) {
        qb.andWhere('i.entity_id = :entityId', { entityId: filter.entityId.trim() });
      }
      if (filter.currentStateCode?.trim()) {
        qb.andWhere('UPPER(i.current_state_code) = :currentStateCode', {
          currentStateCode: filter.currentStateCode.trim().toUpperCase(),
        });
      }
      if (filter.status !== undefined) {
        qb.andWhere('i.status = :status', { status: filter.status });
      }
      if (filter.isOverdue !== undefined) {
        qb.andWhere('i.is_overdue = :isOverdue', { isOverdue: filter.isOverdue });
      }
      if (filter.initiatorUserId !== undefined) {
        qb.andWhere('i.initiator_user_id = :initiatorUserId', {
          initiatorUserId: filter.initiatorUserId,
        });
      }
      if (filter.organizationUnitId !== undefined) {
        qb.andWhere('i.organization_unit_id = :organizationUnitId', {
          organizationUnitId: filter.organizationUnitId,
        });
      }

      if (filter.scopeFilter) {
        this.applyDataScope(qb, filter.scopeFilter, {
          userColumn: 'i.initiator_user_id',
          orgUnitColumn: 'i.organization_unit_id',
        });
      }

      qb.orderBy('i.id', 'DESC');

      return this.paginateQueryBuilder(qb, {
        page: filter.page ?? 1,
        limit: filter.limit ?? 20,
        ...(filter.countMode ? { countMode: filter.countMode } : {}),
      });
    });
  }
}

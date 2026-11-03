import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { WorkflowApprovalDelegationEntity } from '../entities/workflow-approval-delegation.entity.js';

export interface CreateWorkflowApprovalDelegationData {
  readonly fromUserId: number;
  readonly toUserId: number;
  readonly effectiveFrom: Date;
  readonly effectiveUntil: Date;
  readonly workflowCodesJson?: string | null | undefined;
  readonly entityTypesJson?: string | null | undefined;
  readonly organizationUnitId?: number | null | undefined;
  readonly reason?: string | null | undefined;
  readonly isActive?: boolean | undefined;
  readonly createdByUserId?: number | null | undefined;
}

@Injectable()
export class WorkflowApprovalDelegationRepository extends BaseTypeOrmRepository<WorkflowApprovalDelegationEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(WorkflowApprovalDelegationEntity, dataSource, transactionManager);
  }

  public async findAllRules(params?: {
    readonly fromUserId?: number | undefined;
    readonly toUserId?: number | undefined;
    readonly activeOnly?: boolean | undefined;
  }): Promise<WorkflowApprovalDelegationEntity[]> {
    return this.executeReadOnly((repo) => {
      const qb = repo
        .createQueryBuilder('d')
        .where('d.deletedAt IS NULL')
        .orderBy('d.id', 'DESC');

      if (params?.fromUserId !== undefined) {
        qb.andWhere('d.fromUserId = :fromUserId', { fromUserId: Number(params.fromUserId) });
      }
      if (params?.toUserId !== undefined) {
        qb.andWhere('d.toUserId = :toUserId', { toUserId: Number(params.toUserId) });
      }
      if (params?.activeOnly) {
        qb.andWhere('d.isActive = :isActive', { isActive: true });
      }
      return qb.getMany();
    });
  }

  public async createRule(
    data: CreateWorkflowApprovalDelegationData,
  ): Promise<WorkflowApprovalDelegationEntity> {
    const entity = this.repository.create({
      fromUserId: Number(data.fromUserId),
      toUserId: Number(data.toUserId),
      effectiveFrom: data.effectiveFrom,
      effectiveUntil: data.effectiveUntil,
      workflowCodesJson: data.workflowCodesJson ?? null,
      entityTypesJson: data.entityTypesJson ?? null,
      organizationUnitId: data.organizationUnitId ?? null,
      reason: data.reason ?? null,
      isActive: data.isActive ?? true,
      createdByUserId: data.createdByUserId ?? null,
    });
    return this.repository.save(entity);
  }
}

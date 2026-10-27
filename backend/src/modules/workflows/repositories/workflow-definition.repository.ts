import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { CountMode as PaginationCountMode } from '@packages/kernel/index.js';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { WorkflowDefinitionEntity } from '../entities/workflow-definition.entity.js';
import {
  WORKFLOW_DEFINITION_STATUS,
  type WorkflowDefinitionStatusCode,
} from '../enum/workflows.enum.js';

export interface SearchWorkflowDefinitionsFilter {
  readonly search?: string | undefined;
  readonly code?: string | undefined;
  readonly targetEntityType?: string | undefined;
  readonly status?: WorkflowDefinitionStatusCode | undefined;
  readonly page?: number | undefined;
  readonly limit?: number | undefined;
  readonly countMode?: PaginationCountMode | undefined;
}

@Injectable()
export class WorkflowDefinitionRepository extends BaseTypeOrmRepository<WorkflowDefinitionEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(WorkflowDefinitionEntity, dataSource, transactionManager);
  }

  public override async findById(id: number): Promise<WorkflowDefinitionEntity | null> {
    return this.executeReadOnly((repo) => repo.findOne({ where: { id: Number(id) } }));
  }

  public async findByIds(ids: readonly number[]): Promise<WorkflowDefinitionEntity[]> {
    if (ids.length === 0) return [];
    return this.executeReadOnly((repo) =>
      repo
        .createQueryBuilder('d')
        .where('d.id IN (:...ids)', { ids: [...new Set(ids.map(Number))] })
        .getMany(),
    );
  }

  public async findByCodeAndVersion(
    code: string,
    version: number,
  ): Promise<WorkflowDefinitionEntity | null> {
    const normalizedCode = code.trim().toUpperCase();
    return this.executeReadOnly((repo) =>
      repo
        .createQueryBuilder('d')
        .where('UPPER(d.code) = :code AND d.version = :version', {
          code: normalizedCode,
          version: Number(version),
        })
        .getOne(),
    );
  }

  public async findLatestActiveByCode(code: string): Promise<WorkflowDefinitionEntity | null> {
    const normalizedCode = code.trim().toUpperCase();
    return this.executeReadOnly((repo) =>
      repo
        .createQueryBuilder('d')
        .where('UPPER(d.code) = :code AND d.status = :status', {
          code: normalizedCode,
          status: WORKFLOW_DEFINITION_STATUS.ACTIVE,
        })
        .orderBy('d.version', 'DESC')
        .getOne(),
    );
  }

  public async findMaxVersionByCode(code: string): Promise<number> {
    const normalizedCode = code.trim().toUpperCase();
    const rows = await this.executeReadOnly((repo) =>
      repo
        .createQueryBuilder('d')
        .select('d.version', 'version')
        .where('UPPER(d.code) = :code', { code: normalizedCode })
        .orderBy('d.version', 'DESC')
        .limit(1)
        .getRawMany<{ version: number }>(),
    );
    return rows[0]?.version ? Number(rows[0].version) : 0;
  }

  public async searchPaginated(filter: SearchWorkflowDefinitionsFilter = {}): Promise<{
    readonly items: WorkflowDefinitionEntity[];
    readonly total: number;
  }> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo.createQueryBuilder('d');

      if (filter.search?.trim()) {
        const q = `%${filter.search.trim().toLowerCase()}%`;
        qb.andWhere('(LOWER(d.code) LIKE :q OR LOWER(d.name) LIKE :q)', { q });
      }
      if (filter.code?.trim()) {
        qb.andWhere('UPPER(d.code) = :code', { code: filter.code.trim().toUpperCase() });
      }
      if (filter.targetEntityType?.trim()) {
        qb.andWhere('LOWER(d.target_entity_type) = :targetEntityType', {
          targetEntityType: filter.targetEntityType.trim().toLowerCase(),
        });
      }
      if (filter.status !== undefined) {
        qb.andWhere('d.status = :status', { status: filter.status });
      }

      qb.orderBy('d.code', 'ASC').addOrderBy('d.version', 'DESC');

      return this.paginateQueryBuilder(qb, {
        page: filter.page ?? 1,
        limit: filter.limit ?? 20,
        ...(filter.countMode ? { countMode: filter.countMode } : {}),
      });
    });
  }
}

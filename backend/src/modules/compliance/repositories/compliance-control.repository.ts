import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { ComplianceControlEntity } from '../entities/compliance-control.entity.js';
import type { ControlFrequency, ControlStatus } from '../enum/compliance.enum.js';

@Injectable()
export class ComplianceControlRepository extends BaseTypeOrmRepository<ComplianceControlEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ComplianceControlEntity, dataSource as DataSource, transactionManager);
  }

  public create(data: DeepPartial<ComplianceControlEntity>): ComplianceControlEntity {
    return this.repository.create(data);
  }

  public async softDeleteEntity(
    entity: ComplianceControlEntity,
  ): Promise<ComplianceControlEntity> {
    return this.repository.softRemove(entity);
  }

  public async findByCode(controlCode: string): Promise<ComplianceControlEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { controlCode: controlCode.trim() } });
  }

  public async findAll(): Promise<ComplianceControlEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({ order: { id: 'ASC' } });
  }

  public async paginateFiltered(filter: {
    readonly domain?: string | undefined;
    readonly frameworkTag?: string | undefined;
    readonly status?: ControlStatus | undefined;
    readonly frequency?: ControlFrequency | undefined;
    readonly ownerUserId?: number | undefined;
    readonly organizationUnitId?: number | undefined;
    readonly overdueOnly?: boolean | undefined;
    readonly q?: string | undefined;
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
  }): Promise<PaginatedResult<ComplianceControlEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 50);
    }

    const qb = this.repository.createQueryBuilder('c');
    if (filter.domain?.trim()) {
      qb.andWhere('LOWER(c.domain) = :domain', { domain: filter.domain.trim().toLowerCase() });
    }
    if (filter.frameworkTag?.trim()) {
      qb.andWhere('LOWER(c.frameworkTagsJson) LIKE :fw', {
        fw: `%${filter.frameworkTag.trim().toLowerCase()}%`,
      });
    }
    if (filter.status) {
      qb.andWhere('c.status = :status', { status: filter.status });
    }
    if (filter.frequency) {
      qb.andWhere('c.frequency = :freq', { freq: filter.frequency });
    }
    if (filter.ownerUserId !== undefined) {
      qb.andWhere('c.ownerUserId = :ownerId', { ownerId: filter.ownerUserId });
    }
    if (filter.organizationUnitId !== undefined) {
      qb.andWhere('c.organizationUnitId = :orgId', { orgId: filter.organizationUnitId });
    }
    if (filter.overdueOnly) {
      qb.andWhere('c.nextCheckDueAt IS NOT NULL AND c.nextCheckDueAt < :now', {
        now: new Date(),
      });
    }
    if (filter.q?.trim()) {
      const q = `%${filter.q.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(c.controlCode) LIKE :q OR LOWER(c.title) LIKE :q OR LOWER(c.domain) LIKE :q)',
        { q },
      );
    }

    qb.orderBy('c.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, {
      page: filter.page ?? 1,
      limit: filter.limit ?? 50,
    });
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}

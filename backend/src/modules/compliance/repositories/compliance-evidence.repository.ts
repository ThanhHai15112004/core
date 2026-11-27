import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { ComplianceEvidenceEntity } from '../entities/compliance-evidence.entity.js';
import type { EvidenceStatus, EvidenceType } from '../enum/compliance.enum.js';

@Injectable()
export class ComplianceEvidenceRepository extends BaseTypeOrmRepository<ComplianceEvidenceEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ComplianceEvidenceEntity, dataSource as DataSource, transactionManager);
  }

  public create(data: DeepPartial<ComplianceEvidenceEntity>): ComplianceEvidenceEntity {
    return this.repository.create(data);
  }

  public async softDeleteEntity(
    entity: ComplianceEvidenceEntity,
  ): Promise<ComplianceEvidenceEntity> {
    return this.repository.softRemove(entity);
  }

  public async findAll(): Promise<ComplianceEvidenceEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({ order: { collectedAt: 'DESC', id: 'DESC' } });
  }

  public async paginateFiltered(filter: {
    readonly controlId?: number | undefined;
    readonly vendorId?: number | undefined;
    readonly checkHistoryId?: number | undefined;
    readonly evidenceType?: EvidenceType | undefined;
    readonly status?: EvidenceStatus | undefined;
    readonly q?: string | undefined;
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
  }): Promise<PaginatedResult<ComplianceEvidenceEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 50);
    }

    const qb = this.repository.createQueryBuilder('e');
    if (filter.controlId !== undefined) {
      qb.andWhere('e.controlId = :controlId', { controlId: filter.controlId });
    }
    if (filter.vendorId !== undefined) {
      qb.andWhere('e.vendorId = :vendorId', { vendorId: filter.vendorId });
    }
    if (filter.checkHistoryId !== undefined) {
      qb.andWhere('e.checkHistoryId = :checkId', { checkId: filter.checkHistoryId });
    }
    if (filter.evidenceType) {
      qb.andWhere('e.evidenceType = :evType', { evType: filter.evidenceType });
    }
    if (filter.status) {
      qb.andWhere('e.status = :status', { status: filter.status });
    }
    if (filter.q?.trim()) {
      const q = `%${filter.q.trim().toLowerCase()}%`;
      qb.andWhere('(LOWER(e.title) LIKE :q OR LOWER(e.description) LIKE :q)', { q });
    }

    qb.orderBy('e.collectedAt', 'DESC').addOrderBy('e.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, {
      page: filter.page ?? 1,
      limit: filter.limit ?? 50,
    });
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}

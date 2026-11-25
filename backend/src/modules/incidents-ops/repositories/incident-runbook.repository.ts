import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { IncidentRunbookEntity } from '../entities/incident-runbook.entity.js';
import type { IncidentSeverity } from '../enum/incidents-ops.enum.js';

export interface ListRunbooksFilter {
  page?: number | undefined;
  limit?: number | undefined;
  alertCode?: string | undefined;
  severity?: IncidentSeverity | undefined;
  isActive?: boolean | undefined;
  search?: string | undefined;
}

@Injectable()
export class IncidentRunbookRepository extends BaseTypeOrmRepository<IncidentRunbookEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(IncidentRunbookEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findByIdSafe(id: number): Promise<IncidentRunbookEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async findByCode(code: string): Promise<IncidentRunbookEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { code } });
  }

  public async findActiveByAlertCode(alertCode: string): Promise<IncidentRunbookEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({
      where: { alertCode, isActive: true },
      order: { id: 'ASC' },
    });
  }

  public async listPaginated(
    filter: ListRunbooksFilter,
  ): Promise<PaginatedResult<IncidentRunbookEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult(
        [],
        0,
        Number(filter.page ?? 1) || 1,
        Number(filter.limit ?? 20) || 20,
      );
    }

    const qb = this.repository.createQueryBuilder('rb');
    if (filter.alertCode?.trim()) {
      qb.andWhere('rb.alertCode = :alertCode', { alertCode: filter.alertCode.trim() });
    }
    if (filter.severity) {
      qb.andWhere('rb.defaultSeverity = :severity', { severity: filter.severity });
    }
    if (filter.isActive !== undefined) {
      qb.andWhere('rb.isActive = :isActive', { isActive: filter.isActive });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, [
        'rb.code',
        'rb.title',
        'rb.alertCode',
        'rb.description',
      ]);
    }
    qb.orderBy('rb.isSystem', 'DESC').addOrderBy('rb.id', 'DESC');

    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}

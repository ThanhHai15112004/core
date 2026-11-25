import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { AlertRuleEntity } from '../entities/alert-rule.entity.js';
import type { AlertMetricKey, AlertSeverity } from '../enum/metrics-ops.enum.js';

export interface ListAlertRulesFilter {
  page?: number | undefined;
  limit?: number | undefined;
  metricKey?: AlertMetricKey | undefined;
  severity?: AlertSeverity | undefined;
  isEnabled?: boolean | undefined;
  search?: string | undefined;
}

@Injectable()
export class AlertRuleRepository extends BaseTypeOrmRepository<AlertRuleEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(AlertRuleEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findByIdSafe(id: number): Promise<AlertRuleEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async findByCode(code: string): Promise<AlertRuleEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { code } });
  }

  public async listEnabled(): Promise<AlertRuleEntity[]> {
    if (!this.isDatabaseReady()) return [];
    return this.repository.find({
      where: { isEnabled: true },
      order: { id: 'ASC' },
    });
  }

  public async listPaginated(
    filter: ListAlertRulesFilter,
  ): Promise<PaginatedResult<AlertRuleEntity>> {
    if (!this.isDatabaseReady()) {
      return createPaginatedResult(
        [],
        0,
        Number(filter.page ?? 1) || 1,
        Number(filter.limit ?? 20) || 20,
      );
    }

    const qb = this.repository.createQueryBuilder('rule');
    if (filter.metricKey) {
      qb.andWhere('rule.metricKey = :metricKey', { metricKey: filter.metricKey });
    }
    if (filter.severity) {
      qb.andWhere('rule.severity = :severity', { severity: filter.severity });
    }
    if (filter.isEnabled !== undefined) {
      qb.andWhere('rule.isEnabled = :isEnabled', { isEnabled: filter.isEnabled });
    }
    if (filter.search?.trim()) {
      this.applyKeywordSearch(qb, filter.search, ['rule.code', 'rule.name', 'rule.description']);
    }
    qb.orderBy('rule.isSystem', 'DESC').addOrderBy('rule.id', 'DESC');

    const result = await this.paginateQueryBuilder(qb, filter);
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}

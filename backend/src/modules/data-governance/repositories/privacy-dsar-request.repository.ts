import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { DSAR_STATUS, type DsarRequestType } from '../enum/data-governance.enum.js';
import { PrivacyDsarRequestEntity } from '../entities/privacy-dsar-request.entity.js';

@Injectable()
export class PrivacyDsarRequestRepository extends BaseTypeOrmRepository<PrivacyDsarRequestEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(PrivacyDsarRequestEntity, dataSource as DataSource, transactionManager);
  }

  public create(data: DeepPartial<PrivacyDsarRequestEntity>): PrivacyDsarRequestEntity {
    return this.repository.create(data);
  }

  public async findByExportToken(token: string): Promise<PrivacyDsarRequestEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { exportToken: token.trim() } });
  }

  public async findAll(): Promise<PrivacyDsarRequestEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({ order: { id: 'DESC' } });
  }

  public async findExpiredExportTokens(now: Date): Promise<PrivacyDsarRequestEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository
      .createQueryBuilder('r')
      .where('r.exportToken IS NOT NULL')
      .andWhere('r.exportExpiresAt IS NOT NULL')
      .andWhere('r.exportExpiresAt <= :now', { now })
      .getMany();
  }

  public async countByStatuses(): Promise<{ pending: number; pendingApprovalErasure: number }> {
    if (!this.dataSource?.isInitialized) {
      return { pending: 0, pendingApprovalErasure: 0 };
    }
    const [pending, pendingApprovalErasure] = await Promise.all([
      this.repository.count({
        where: [{ status: DSAR_STATUS.PENDING }, { status: DSAR_STATUS.PENDING_APPROVAL }],
      }),
      this.repository.count({
        where: { requestType: 'ERASURE', status: DSAR_STATUS.PENDING_APPROVAL },
      }),
    ]);
    return { pending, pendingApprovalErasure };
  }

  public async paginateFiltered(filter: {
    readonly requestType?: DsarRequestType | undefined;
    readonly subjectUserId?: number | undefined;
    readonly status?: number | undefined;
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
  }): Promise<PaginatedResult<PrivacyDsarRequestEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 25);
    }
    const qb = this.repository.createQueryBuilder('r');
    if (filter.requestType) {
      qb.andWhere('r.requestType = :requestType', { requestType: filter.requestType });
    }
    if (filter.subjectUserId !== undefined) {
      qb.andWhere('r.subjectUserId = :subjectUserId', { subjectUserId: filter.subjectUserId });
    }
    if (filter.status !== undefined) {
      qb.andWhere('r.status = :status', { status: filter.status });
    }
    qb.orderBy('r.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, {
      page: filter.page ?? 1,
      limit: filter.limit ?? 25,
    });
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}

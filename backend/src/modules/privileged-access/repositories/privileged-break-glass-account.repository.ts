import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { BREAK_GLASS_STATUS, type BreakGlassStatusCode } from '../enum/privileged-access.enum.js';
import { PrivilegedBreakGlassAccountEntity } from '../entities/privileged-break-glass-account.entity.js';

@Injectable()
export class PrivilegedBreakGlassAccountRepository extends BaseTypeOrmRepository<PrivilegedBreakGlassAccountEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(PrivilegedBreakGlassAccountEntity, dataSource as DataSource, transactionManager);
  }

  public create(
    data: DeepPartial<PrivilegedBreakGlassAccountEntity>,
  ): PrivilegedBreakGlassAccountEntity {
    return this.repository.create(data);
  }

  public async findByCode(code: string): Promise<PrivilegedBreakGlassAccountEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { code: code.trim() } });
  }

  public async findByUserId(userId: number): Promise<PrivilegedBreakGlassAccountEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { userId: Number(userId) } });
  }

  public async findAll(): Promise<PrivilegedBreakGlassAccountEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({ order: { id: 'ASC' } });
  }

  public async findExpiredActive(now: Date): Promise<PrivilegedBreakGlassAccountEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository
      .createQueryBuilder('bg')
      .where('bg.status = :status', { status: BREAK_GLASS_STATUS.ACTIVE })
      .andWhere('bg.expiresAt IS NOT NULL')
      .andWhere('bg.expiresAt <= :now', { now })
      .orderBy('bg.expiresAt', 'ASC')
      .getMany();
  }

  public async paginateFiltered(filter: {
    readonly status?: BreakGlassStatusCode | undefined;
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
  }): Promise<PaginatedResult<PrivilegedBreakGlassAccountEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 50);
    }
    const qb = this.repository.createQueryBuilder('bg');
    if (filter.status !== undefined) {
      qb.andWhere('bg.status = :status', { status: filter.status });
    }
    qb.orderBy('bg.id', 'ASC');
    const result = await this.paginateQueryBuilder(qb, {
      page: filter.page ?? 1,
      limit: filter.limit ?? 50,
    });
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}

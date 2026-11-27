import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import {
  PRIVILEGED_GRANT_STATUS,
  type PrivilegedGrantStatusCode,
  type PrivilegedTargetType,
} from '../enum/privileged-access.enum.js';
import { PrivilegedAccessGrantEntity } from '../entities/privileged-access-grant.entity.js';

@Injectable()
export class PrivilegedAccessGrantRepository extends BaseTypeOrmRepository<PrivilegedAccessGrantEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(PrivilegedAccessGrantEntity, dataSource as DataSource, transactionManager);
  }

  public create(data: DeepPartial<PrivilegedAccessGrantEntity>): PrivilegedAccessGrantEntity {
    return this.repository.create(data);
  }

  public async findActiveForUser(
    userId: number,
    now: Date = new Date(),
  ): Promise<PrivilegedAccessGrantEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository
      .createQueryBuilder('g')
      .where('g.userId = :userId', { userId: Number(userId) })
      .andWhere('g.status = :status', { status: PRIVILEGED_GRANT_STATUS.ACTIVE })
      .andWhere('(g.startsAt IS NULL OR g.startsAt <= :now)', { now })
      .andWhere('g.expiresAt IS NOT NULL')
      .andWhere('g.expiresAt > :now', { now })
      .orderBy('g.id', 'ASC')
      .getMany();
  }

  public async findAllActive(now: Date = new Date()): Promise<PrivilegedAccessGrantEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository
      .createQueryBuilder('g')
      .where('g.status = :status', { status: PRIVILEGED_GRANT_STATUS.ACTIVE })
      .andWhere('g.expiresAt IS NOT NULL')
      .andWhere('g.expiresAt > :now', { now })
      .orderBy('g.id', 'ASC')
      .getMany();
  }

  public async findExpiredActive(now: Date = new Date()): Promise<PrivilegedAccessGrantEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository
      .createQueryBuilder('g')
      .where('g.status = :status', { status: PRIVILEGED_GRANT_STATUS.ACTIVE })
      .andWhere('g.expiresAt IS NOT NULL')
      .andWhere('g.expiresAt <= :now', { now })
      .orderBy('g.expiresAt', 'ASC')
      .getMany();
  }

  public async countByStatus(status: PrivilegedGrantStatusCode): Promise<number> {
    if (!this.dataSource?.isInitialized) return 0;
    return this.repository.count({ where: { status } });
  }

  public async paginateFiltered(filter: {
    readonly userId?: number | undefined;
    readonly status?: PrivilegedGrantStatusCode | undefined;
    readonly targetType?: PrivilegedTargetType | undefined;
    readonly targetCode?: string | undefined;
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
  }): Promise<PaginatedResult<PrivilegedAccessGrantEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 20);
    }
    const qb = this.repository.createQueryBuilder('g');
    if (filter.userId !== undefined) {
      qb.andWhere('g.userId = :userId', { userId: Number(filter.userId) });
    }
    if (filter.status !== undefined) {
      qb.andWhere('g.status = :status', { status: filter.status });
    }
    if (filter.targetType) {
      qb.andWhere('g.targetType = :targetType', { targetType: filter.targetType });
    }
    if (filter.targetCode?.trim()) {
      qb.andWhere('g.targetCode = :targetCode', { targetCode: filter.targetCode.trim() });
    }
    qb.orderBy('g.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, {
      page: filter.page ?? 1,
      limit: filter.limit ?? 20,
    });
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}

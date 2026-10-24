import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import {
  BaseTypeOrmRepository,
  type PaginatedQueryBuilderResult,
  TransactionManager,
} from '@packages/database/index.js';
import type { RawPaginationInput } from '@packages/kernel/index.js';
import { NotificationEntity } from '../entities/notification.entity.js';

export interface NotificationDispatchFilterOptions extends RawPaginationInput {
  readonly search?: string | undefined;
  readonly category?: number | undefined;
  readonly priority?: number | undefined;
  readonly targetType?: number | undefined;
  readonly organizationUnitId?: number | undefined;
  readonly senderUserId?: number | undefined;
}

@Injectable()
export class NotificationsRepository extends BaseTypeOrmRepository<NotificationEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(NotificationEntity, dataSource, transactionManager);
  }

  public async findByIds(ids: readonly number[]): Promise<NotificationEntity[]> {
    const uniqueIds = [...new Set(ids.map(Number).filter((n) => Number.isFinite(n) && n >= 1))];
    if (uniqueIds.length === 0) return [];
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { id: In(uniqueIds) },
        order: { id: 'DESC' },
      }),
    );
  }

  public async findPaginatedDispatches(
    options: NotificationDispatchFilterOptions,
  ): Promise<PaginatedQueryBuilderResult<NotificationEntity>> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo.createQueryBuilder('n').where('n.deletedAt IS NULL');

      if (options.category !== undefined) {
        qb.andWhere('n.category = :category', { category: options.category });
      }
      if (options.priority !== undefined) {
        qb.andWhere('n.priority = :priority', { priority: options.priority });
      }
      if (options.targetType !== undefined) {
        qb.andWhere('n.targetType = :targetType', { targetType: options.targetType });
      }
      if (options.organizationUnitId !== undefined) {
        qb.andWhere('n.organizationUnitId = :orgUnitId', {
          orgUnitId: options.organizationUnitId,
        });
      }
      if (options.senderUserId !== undefined) {
        qb.andWhere('n.senderUserId = :senderUserId', {
          senderUserId: options.senderUserId,
        });
      }
      if (options.search && options.search.trim().length > 0) {
        const kw = `%${options.search.trim().toLowerCase()}%`;
        qb.andWhere(
          '(LOWER(n.title) LIKE :kw OR LOWER(n.content) LIKE :kw OR LOWER(n.code) LIKE :kw)',
          { kw },
        );
      }

      qb.orderBy('n.dispatchedAt', 'DESC').addOrderBy('n.id', 'DESC');

      return this.paginateQueryBuilder(qb, options, {
        settingPrefix: 'notifications.pagination',
      });
    });
  }
}

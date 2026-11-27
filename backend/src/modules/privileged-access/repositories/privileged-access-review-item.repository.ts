import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { PrivilegedAccessReviewItemEntity } from '../entities/privileged-access-review-item.entity.js';

@Injectable()
export class PrivilegedAccessReviewItemRepository extends BaseTypeOrmRepository<PrivilegedAccessReviewItemEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(PrivilegedAccessReviewItemEntity, dataSource as DataSource, transactionManager);
  }

  public create(
    data: DeepPartial<PrivilegedAccessReviewItemEntity>,
  ): PrivilegedAccessReviewItemEntity {
    return this.repository.create(data);
  }

  public async saveMany(
    items: PrivilegedAccessReviewItemEntity[],
  ): Promise<PrivilegedAccessReviewItemEntity[]> {
    if (items.length === 0) return [];
    return this.repository.save(items);
  }

  public async findByReviewId(reviewId: number): Promise<PrivilegedAccessReviewItemEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { reviewId: Number(reviewId) },
      order: { id: 'ASC' },
    });
  }

  public async findByIdAndReviewId(
    itemId: number,
    reviewId: number,
  ): Promise<PrivilegedAccessReviewItemEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: { id: Number(itemId), reviewId: Number(reviewId) },
    });
  }
}

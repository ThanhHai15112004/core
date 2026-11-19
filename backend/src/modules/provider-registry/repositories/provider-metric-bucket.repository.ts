import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import type { ProviderTypeName } from '@packages/kernel/index.js';
import { ProviderMetricBucketEntity } from '../entities/provider-metric-bucket.entity.js';

@Injectable()
export class ProviderMetricBucketRepository extends BaseTypeOrmRepository<ProviderMetricBucketEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ProviderMetricBucketEntity, dataSource as DataSource, transactionManager);
  }

  public async findBucket(
    providerId: number,
    bucketStart: Date,
  ): Promise<ProviderMetricBucketEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: {
        providerId: Number(providerId),
        bucketStart,
      },
    });
  }

  public async listBucketsSince(params: {
    readonly since: Date;
    readonly providerId?: number | undefined;
    readonly providerType?: ProviderTypeName | undefined;
  }): Promise<ProviderMetricBucketEntity[]> {
    if (!this.dataSource?.isInitialized) return [];

    const qb = this.repository
      .createQueryBuilder('bucket')
      .where('bucket.bucketStart >= :since', { since: params.since });

    if (params.providerId !== undefined) {
      qb.andWhere('bucket.providerId = :providerId', { providerId: Number(params.providerId) });
    }
    if (params.providerType) {
      qb.andWhere('bucket.providerType = :providerType', { providerType: params.providerType });
    }

    qb.orderBy('bucket.bucketStart', 'ASC');
    return qb.getMany();
  }
}

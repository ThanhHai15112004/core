import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { CustomFieldHistoryEntity } from '../entities/custom-field-history.entity.js';

@Injectable()
export class CustomFieldHistoryRepository extends BaseTypeOrmRepository<CustomFieldHistoryEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(CustomFieldHistoryEntity, dataSource as DataSource, transactionManager);
  }

  public async findAllOrdered(limit = 200): Promise<CustomFieldHistoryEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      order: { createdAt: 'DESC', id: 'DESC' },
      take: limit,
    });
  }

  public async recordHistory(
    payload: Partial<CustomFieldHistoryEntity>,
  ): Promise<CustomFieldHistoryEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.saveEntity(payload);
  }
}

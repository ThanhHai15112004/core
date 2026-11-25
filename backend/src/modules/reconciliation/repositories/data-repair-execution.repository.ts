import { Injectable, Optional } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { DataRepairExecutionEntity } from '../entities/data-repair-execution.entity.js';

@Injectable()
export class DataRepairExecutionRepository extends BaseTypeOrmRepository<DataRepairExecutionEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(DataRepairExecutionEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async listByRepairRequestId(repairRequestId: number): Promise<DataRepairExecutionEntity[]> {
    if (!this.isDatabaseReady()) return [];
    return this.repository.find({
      where: { repairRequestId },
      order: { executedAt: 'ASC', id: 'ASC' },
    });
  }
}

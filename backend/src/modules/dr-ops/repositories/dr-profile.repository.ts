import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { DrProfileEntity } from '../entities/dr-profile.entity.js';

@Injectable()
export class DrProfileRepository extends BaseTypeOrmRepository<DrProfileEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(DrProfileEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async findByCodeSafe(code = 'DEFAULT'): Promise<DrProfileEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { code } });
  }
}

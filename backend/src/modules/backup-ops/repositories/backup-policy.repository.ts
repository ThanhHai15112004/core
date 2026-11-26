import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { BackupPolicyEntity } from '../entities/backup-policy.entity.js';
import type { BackupTargetType } from '../enum/backup-ops.enum.js';

@Injectable()
export class BackupPolicyRepository extends BaseTypeOrmRepository<BackupPolicyEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(BackupPolicyEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async listAll(): Promise<BackupPolicyEntity[]> {
    if (!this.isDatabaseReady()) return [];
    return this.repository.find({ order: { id: 'ASC' } });
  }

  public async listEnabled(): Promise<BackupPolicyEntity[]> {
    if (!this.isDatabaseReady()) return [];
    return this.repository.find({ where: { isEnabled: true }, order: { id: 'ASC' } });
  }

  public async findByIdSafe(id: number): Promise<BackupPolicyEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { id } });
  }

  public async findByCodeSafe(code: string): Promise<BackupPolicyEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { code } });
  }

  public async findFirstEnabledByTarget(
    targetType: BackupTargetType,
  ): Promise<BackupPolicyEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({
      where: { targetType, isEnabled: true },
      order: { id: 'ASC' },
    });
  }
}

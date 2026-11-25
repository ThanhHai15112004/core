import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { IncidentSeverityPolicyEntity } from '../entities/incident-severity-policy.entity.js';
import type { IncidentSeverity } from '../enum/incidents-ops.enum.js';

@Injectable()
export class IncidentSeverityPolicyRepository extends BaseTypeOrmRepository<IncidentSeverityPolicyEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(IncidentSeverityPolicyEntity, dataSource as DataSource, transactionManager);
  }

  public isDatabaseReady(): boolean {
    return Boolean(this.dataSource?.isInitialized || this.transactionManager?.isInTransaction());
  }

  public async listAll(): Promise<IncidentSeverityPolicyEntity[]> {
    if (!this.isDatabaseReady()) return [];
    return this.repository.find({ order: { severity: 'ASC' } });
  }

  public async findBySeverity(
    severity: IncidentSeverity,
  ): Promise<IncidentSeverityPolicyEntity | null> {
    if (!this.isDatabaseReady()) return null;
    return this.repository.findOne({ where: { severity } });
  }
}

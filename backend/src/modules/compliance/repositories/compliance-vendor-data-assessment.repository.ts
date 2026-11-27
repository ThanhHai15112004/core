import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { ComplianceVendorDataAssessmentEntity } from '../entities/compliance-vendor-data-assessment.entity.js';

@Injectable()
export class ComplianceVendorDataAssessmentRepository extends BaseTypeOrmRepository<ComplianceVendorDataAssessmentEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ComplianceVendorDataAssessmentEntity, dataSource as DataSource, transactionManager);
  }

  public create(
    data: DeepPartial<ComplianceVendorDataAssessmentEntity>,
  ): ComplianceVendorDataAssessmentEntity {
    return this.repository.create(data);
  }

  public async softDeleteEntity(
    entity: ComplianceVendorDataAssessmentEntity,
  ): Promise<ComplianceVendorDataAssessmentEntity> {
    return this.repository.softRemove(entity);
  }

  public async findAll(): Promise<ComplianceVendorDataAssessmentEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({ order: { id: 'DESC' } });
  }

  public async findByVendorId(vendorId: number): Promise<ComplianceVendorDataAssessmentEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { vendorId },
      order: { id: 'DESC' },
    });
  }
}

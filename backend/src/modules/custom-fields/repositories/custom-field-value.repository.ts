import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { CustomFieldValueEntity } from '../entities/custom-field-value.entity.js';

@Injectable()
export class CustomFieldValueRepository extends BaseTypeOrmRepository<CustomFieldValueEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(CustomFieldValueEntity, dataSource as DataSource, transactionManager);
  }

  public async findAllValues(): Promise<CustomFieldValueEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      order: { entityCode: 'ASC', recordId: 'ASC', fieldKey: 'ASC' },
    });
  }

  public async findByEntityAndRecord(
    entityCode: string,
    recordId: string,
  ): Promise<CustomFieldValueEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: {
        entityCode: entityCode.trim().toLowerCase(),
        recordId: String(recordId).trim(),
      },
    });
  }

  public async upsertValue(
    payload: Partial<CustomFieldValueEntity> & {
      readonly entityCode: string;
      readonly recordId: string;
      readonly fieldKey: string;
    },
  ): Promise<CustomFieldValueEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    const existing = await this.repository.findOne({
      where: {
        entityCode: payload.entityCode.trim().toLowerCase(),
        recordId: String(payload.recordId).trim(),
        fieldKey: payload.fieldKey.trim().toLowerCase(),
      },
    });
    return this.saveEntity({
      ...(existing ? { id: existing.id } : {}),
      ...payload,
    });
  }
}

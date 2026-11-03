import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { CustomFieldDefinitionEntity } from '../entities/custom-field-definition.entity.js';

@Injectable()
export class CustomFieldDefinitionRepository extends BaseTypeOrmRepository<CustomFieldDefinitionEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(CustomFieldDefinitionEntity, dataSource as DataSource, transactionManager);
  }

  public async findAllOrdered(): Promise<CustomFieldDefinitionEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      order: { entityCode: 'ASC', sortOrder: 'ASC', id: 'ASC' },
    });
  }

  public async findByEntityAndKey(
    entityCode: string,
    fieldKey: string,
  ): Promise<CustomFieldDefinitionEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: {
        entityCode: entityCode.trim().toLowerCase(),
        fieldKey: fieldKey.trim().toLowerCase(),
      },
    });
  }

  public async upsertDefinition(
    payload: Partial<CustomFieldDefinitionEntity> & {
      readonly entityCode: string;
      readonly fieldKey: string;
    },
  ): Promise<CustomFieldDefinitionEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    const existing = await this.findByEntityAndKey(payload.entityCode, payload.fieldKey);
    return this.saveEntity({
      ...(existing ? { id: existing.id } : {}),
      ...payload,
    });
  }
}

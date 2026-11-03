import { Injectable, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { CustomFieldOptionEntity } from '../entities/custom-field-option.entity.js';

@Injectable()
export class CustomFieldOptionRepository extends BaseTypeOrmRepository<CustomFieldOptionEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(CustomFieldOptionEntity, dataSource as DataSource, transactionManager);
  }

  public async findByFieldId(fieldId: string): Promise<CustomFieldOptionEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { fieldId: String(fieldId) },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
  }

  public async findAllOrdered(): Promise<CustomFieldOptionEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      order: { fieldId: 'ASC', sortOrder: 'ASC', id: 'ASC' },
    });
  }

  public async replaceOptionsForField(
    fieldId: string,
    options: Array<Partial<CustomFieldOptionEntity>>,
  ): Promise<CustomFieldOptionEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    await this.repository.delete({ fieldId: String(fieldId) });
    const saved: CustomFieldOptionEntity[] = [];
    for (const opt of options) {
      const entity = await this.saveEntity({
        ...opt,
        fieldId: String(fieldId),
      });
      saved.push(entity);
    }
    return saved;
  }
}

import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { DataClassificationLevel, PaginatedResult } from '@packages/kernel/index.js';
import { DataClassificationEntity } from '../entities/data-classification.entity.js';

@Injectable()
export class DataClassificationRepository extends BaseTypeOrmRepository<DataClassificationEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(DataClassificationEntity, dataSource as DataSource, transactionManager);
  }

  public create(data: DeepPartial<DataClassificationEntity>): DataClassificationEntity {
    return this.repository.create(data);
  }

  public async findByCode(dataTypeCode: string): Promise<DataClassificationEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: { dataTypeCode: dataTypeCode.trim().toLowerCase() },
    });
  }

  public async findAll(): Promise<DataClassificationEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({ order: { id: 'ASC' } });
  }

  public async findAllEnabled(): Promise<DataClassificationEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { isEnabled: true },
      order: { id: 'ASC' },
    });
  }

  public async paginateFiltered(filter: {
    readonly classificationLevel?: DataClassificationLevel | undefined;
    readonly moduleName?: string | undefined;
    readonly isEnabled?: boolean | undefined;
    readonly search?: string | undefined;
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
  }): Promise<PaginatedResult<DataClassificationEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 50);
    }
    const qb = this.repository.createQueryBuilder('c');
    if (filter.classificationLevel) {
      qb.andWhere('c.classificationLevel = :lvl', { lvl: filter.classificationLevel });
    }
    if (filter.moduleName?.trim()) {
      qb.andWhere('LOWER(c.moduleName) = :mod', { mod: filter.moduleName.trim().toLowerCase() });
    }
    if (filter.isEnabled !== undefined) {
      qb.andWhere('c.isEnabled = :isEnabled', { isEnabled: filter.isEnabled });
    }
    if (filter.search?.trim()) {
      const q = `%${filter.search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(c.dataTypeCode) LIKE :q OR LOWER(c.displayName) LIKE :q OR LOWER(c.moduleName) LIKE :q)',
        { q },
      );
    }
    qb.orderBy('c.id', 'ASC');
    const result = await this.paginateQueryBuilder(qb, {
      page: filter.page ?? 1,
      limit: filter.limit ?? 50,
    });
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}

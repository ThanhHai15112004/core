import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { DataClassificationLevel, PaginatedResult } from '@packages/kernel/index.js';
import { DataSensitiveFieldEntity } from '../entities/data-sensitive-field.entity.js';

@Injectable()
export class DataSensitiveFieldRepository extends BaseTypeOrmRepository<DataSensitiveFieldEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(DataSensitiveFieldEntity, dataSource as DataSource, transactionManager);
  }

  public create(data: DeepPartial<DataSensitiveFieldEntity>): DataSensitiveFieldEntity {
    return this.repository.create(data);
  }

  public async findByResourceAndPath(
    resourceType: string,
    fieldPath: string,
  ): Promise<DataSensitiveFieldEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: {
        resourceType: resourceType.trim().toLowerCase(),
        fieldPath: fieldPath.trim(),
      },
    });
  }

  public async findAll(): Promise<DataSensitiveFieldEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({ order: { id: 'ASC' } });
  }

  public async findAllEnabled(): Promise<DataSensitiveFieldEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { isEnabled: true },
      order: { id: 'ASC' },
    });
  }

  public async paginateFiltered(filter: {
    readonly resourceType?: string | undefined;
    readonly classificationLevel?: DataClassificationLevel | undefined;
    readonly isEnabled?: boolean | undefined;
    readonly search?: string | undefined;
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
  }): Promise<PaginatedResult<DataSensitiveFieldEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 50);
    }
    const qb = this.repository.createQueryBuilder('f');
    if (filter.resourceType?.trim()) {
      qb.andWhere('LOWER(f.resourceType) = :res', {
        res: filter.resourceType.trim().toLowerCase(),
      });
    }
    if (filter.classificationLevel) {
      qb.andWhere('f.classificationLevel = :lvl', { lvl: filter.classificationLevel });
    }
    if (filter.isEnabled !== undefined) {
      qb.andWhere('f.isEnabled = :isEnabled', { isEnabled: filter.isEnabled });
    }
    if (filter.search?.trim()) {
      const q = `%${filter.search.trim().toLowerCase()}%`;
      qb.andWhere(
        '(LOWER(f.resourceType) LIKE :q OR LOWER(f.fieldPath) LIKE :q OR LOWER(f.displayName) LIKE :q)',
        { q },
      );
    }
    qb.orderBy('f.id', 'ASC');
    const result = await this.paginateQueryBuilder(qb, {
      page: filter.page ?? 1,
      limit: filter.limit ?? 50,
    });
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}

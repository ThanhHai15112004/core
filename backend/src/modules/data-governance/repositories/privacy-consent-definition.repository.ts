import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { PrivacyConsentDefinitionEntity } from '../entities/privacy-consent-definition.entity.js';

@Injectable()
export class PrivacyConsentDefinitionRepository extends BaseTypeOrmRepository<PrivacyConsentDefinitionEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(PrivacyConsentDefinitionEntity, dataSource as DataSource, transactionManager);
  }

  public create(
    data: DeepPartial<PrivacyConsentDefinitionEntity>,
  ): PrivacyConsentDefinitionEntity {
    return this.repository.create(data);
  }

  public async findByPurposeAndVersion(
    purposeCode: string,
    policyVersion: string,
  ): Promise<PrivacyConsentDefinitionEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: {
        purposeCode: purposeCode.trim().toLowerCase(),
        policyVersion: policyVersion.trim(),
      },
    });
  }

  public async findLatestActiveByPurpose(
    purposeCode: string,
  ): Promise<PrivacyConsentDefinitionEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({
      where: {
        purposeCode: purposeCode.trim().toLowerCase(),
        isActive: true,
      },
      order: { id: 'DESC' },
    });
  }

  public async findAllActive(): Promise<PrivacyConsentDefinitionEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({
      where: { isActive: true },
      order: { id: 'ASC' },
    });
  }

  public async paginateFiltered(filter: {
    readonly purposeCode?: string | undefined;
    readonly isActive?: boolean | undefined;
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
  }): Promise<PaginatedResult<PrivacyConsentDefinitionEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 50);
    }
    const qb = this.repository.createQueryBuilder('d');
    if (filter.purposeCode?.trim()) {
      qb.andWhere('LOWER(d.purposeCode) = :purpose', {
        purpose: filter.purposeCode.trim().toLowerCase(),
      });
    }
    if (filter.isActive !== undefined) {
      qb.andWhere('d.isActive = :isActive', { isActive: filter.isActive });
    }
    qb.orderBy('d.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, {
      page: filter.page ?? 1,
      limit: filter.limit ?? 50,
    });
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}

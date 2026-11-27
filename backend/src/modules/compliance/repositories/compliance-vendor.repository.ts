import { Injectable, Optional } from '@nestjs/common';
import { DataSource, type DeepPartial } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { createPaginatedResult } from '@packages/http/index.js';
import type { PaginatedResult } from '@packages/kernel/index.js';
import { ComplianceVendorEntity } from '../entities/compliance-vendor.entity.js';
import type { ComplianceRiskLevel, VendorCategory, VendorStatus } from '../enum/compliance.enum.js';

@Injectable()
export class ComplianceVendorRepository extends BaseTypeOrmRepository<ComplianceVendorEntity> {
  constructor(
    @Optional() dataSource?: DataSource,
    @Optional() transactionManager?: TransactionManager,
  ) {
    super(ComplianceVendorEntity, dataSource as DataSource, transactionManager);
  }

  public create(data: DeepPartial<ComplianceVendorEntity>): ComplianceVendorEntity {
    return this.repository.create(data);
  }

  public async softDeleteEntity(entity: ComplianceVendorEntity): Promise<ComplianceVendorEntity> {
    return this.repository.softRemove(entity);
  }

  public async findByCode(vendorCode: string): Promise<ComplianceVendorEntity | null> {
    if (!this.dataSource?.isInitialized) return null;
    return this.repository.findOne({ where: { vendorCode: vendorCode.trim() } });
  }

  public async findAll(): Promise<ComplianceVendorEntity[]> {
    if (!this.dataSource?.isInitialized) return [];
    return this.repository.find({ order: { id: 'ASC' } });
  }

  public async paginateFiltered(filter: {
    readonly category?: VendorCategory | undefined;
    readonly criticality?: ComplianceRiskLevel | undefined;
    readonly status?: VendorStatus | undefined;
    readonly missingFallbackOnly?: boolean | undefined;
    readonly expiringContractOnly?: boolean | undefined;
    readonly contractWindowDays?: number | undefined;
    readonly q?: string | undefined;
    readonly page?: number | undefined;
    readonly limit?: number | undefined;
  }): Promise<PaginatedResult<ComplianceVendorEntity>> {
    if (!this.dataSource?.isInitialized) {
      return createPaginatedResult([], 0, filter.page ?? 1, filter.limit ?? 50);
    }

    const qb = this.repository.createQueryBuilder('v');
    if (filter.category) {
      qb.andWhere('v.category = :category', { category: filter.category });
    }
    if (filter.criticality) {
      qb.andWhere('v.criticality = :criticality', { criticality: filter.criticality });
    }
    if (filter.status) {
      qb.andWhere('v.status = :status', { status: filter.status });
    }
    if (filter.missingFallbackOnly) {
      qb.andWhere(
        "(v.fallbackVendorName IS NULL OR TRIM(v.fallbackVendorName) = '') AND (v.fallbackStrategy IS NULL OR TRIM(v.fallbackStrategy) = '')",
      );
    }
    if (filter.expiringContractOnly) {
      const days = filter.contractWindowDays ?? 45;
      const cutoff = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      qb.andWhere('v.contractEndDate IS NOT NULL AND v.contractEndDate <= :cutoff', { cutoff });
    }
    if (filter.q?.trim()) {
      const q = `%${filter.q.trim().toLowerCase()}%`;
      qb.andWhere('(LOWER(v.vendorCode) LIKE :q OR LOWER(v.name) LIKE :q)', { q });
    }

    qb.orderBy('v.id', 'DESC');
    const result = await this.paginateQueryBuilder(qb, {
      page: filter.page ?? 1,
      limit: filter.limit ?? 50,
    });
    return createPaginatedResult(result.items, result.nullableTotal, result.page, result.limit);
  }
}

import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { OrganizationUnitEntity } from '../entities/organization-unit.entity.js';
import type { OrganizationUnitStatus, OrganizationUnitType } from '../contracts/index.js';

export interface ListOrganizationUnitsFilter {
  readonly q?: string | undefined;
  readonly type?: OrganizationUnitType | undefined;
  readonly status?: OrganizationUnitStatus | undefined;
  readonly parentId?: string | undefined;
}

@Injectable()
export class OrganizationUnitRepository extends BaseTypeOrmRepository<OrganizationUnitEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(OrganizationUnitEntity, dataSource, transactionManager);
  }

  /** Tìm đơn vị theo mã code */
  public async findByCode(code: string): Promise<OrganizationUnitEntity | null> {
    return this.repository.findOne({
      where: { code: code.trim().toUpperCase() },
    });
  }

  /** Tìm danh sách đơn vị theo mảng ID */
  public async findByIds(ids: readonly string[]): Promise<OrganizationUnitEntity[]> {
    if (ids.length === 0) return [];
    const uniqueIds = [...new Set(ids)];
    return this.repository.find({
      where: { id: In(uniqueIds) },
    });
  }

  /** Tìm danh sách đơn vị theo mảng mã code */
  public async findByCodes(codes: readonly string[]): Promise<OrganizationUnitEntity[]> {
    if (codes.length === 0) return [];
    const normalized = [...new Set(codes.map((c) => c.trim().toUpperCase()))];
    return this.repository.find({
      where: { code: In(normalized) },
    });
  }

  /** Truy vấn danh sách đơn vị/chi nhánh có lọc */
  public async findFiltered(
    filter: ListOrganizationUnitsFilter = {},
  ): Promise<OrganizationUnitEntity[]> {
    const qb = this.repository.createQueryBuilder('ou');

    if (filter.q && filter.q.trim().length > 0) {
      const kw = `%${filter.q.trim().toLowerCase()}%`;
      qb.andWhere('(LOWER(ou.name) LIKE :kw OR LOWER(ou.code) LIKE :kw)', { kw });
    }

    if (filter.type) {
      qb.andWhere('ou.type = :type', { type: filter.type });
    }

    if (filter.status) {
      qb.andWhere('ou.status = :status', { status: filter.status });
    }

    if (filter.parentId) {
      qb.andWhere('ou.parent_id = :parentId', { parentId: filter.parentId });
    }

    qb.orderBy('ou.code', 'ASC');
    return qb.getMany();
  }
}

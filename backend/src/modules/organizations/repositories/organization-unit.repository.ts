import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { OrganizationUnitEntity } from '../entities/organization-unit.entity.js';
import type { ListOrganizationUnitsQuery } from '../requests/organizations.requests.js';

const ORG_UNIT_SORT_COLUMN_MAP: Readonly<Record<string, string>> = {
  id: 'ou.id',
  code: 'ou.code',
  name: 'ou.name',
  createdAt: 'ou.createdAt',
};

@Injectable()
export class OrganizationUnitRepository extends BaseTypeOrmRepository<OrganizationUnitEntity> {
  constructor(
    dataSource: DataSource,
    @Optional() transactionManager: TransactionManager | null = null,
  ) {
    super(OrganizationUnitEntity, dataSource, transactionManager);
  }

  /** Tìm một đơn vị/chi nhánh theo mã code (không phân biệt hoa thường) */
  public async findByCode(code: string): Promise<OrganizationUnitEntity | null> {
    const normalized = code.trim().toUpperCase();
    return this.executeReadOnly(async (repo) =>
      repo.findOne({
        where: { code: normalized },
      }),
    );
  }

  /** Tìm danh sách đơn vị theo mảng ID số nguyên */
  public async findByIds(ids: readonly number[]): Promise<OrganizationUnitEntity[]> {
    if (ids.length === 0) return [];
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { id: In([...ids]) },
        order: { id: 'ASC' },
      }),
    );
  }

  /** Tìm danh sách đơn vị theo mảng mã code */
  public async findByCodes(codes: readonly string[]): Promise<OrganizationUnitEntity[]> {
    if (codes.length === 0) return [];
    const normalized = codes.map((c) => c.trim().toUpperCase());
    return this.executeReadOnly(async (repo) =>
      repo.find({
        where: { code: In(normalized) },
        order: { id: 'ASC' },
      }),
    );
  }

  /** Tìm danh sách đơn vị/chi nhánh theo điều kiện lọc (Query Core 8.1) */
  public async findFiltered(query: ListOrganizationUnitsQuery): Promise<OrganizationUnitEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo.createQueryBuilder('ou');

      if (query.type !== undefined) {
        qb.andWhere('ou.type = :type', { type: query.type });
      }
      if (query.status !== undefined) {
        qb.andWhere('ou.status = :status', { status: query.status });
      }
      if (query.parentId !== undefined) {
        qb.andWhere('ou.parentId = :parentId', { parentId: query.parentId });
      }
      this.applyKeywordSearch(qb, query.search ?? query.q, ['ou.code', 'ou.name'], {
        paramPrefix: 'ouKw',
      });
      this.applySort(qb, query, ORG_UNIT_SORT_COLUMN_MAP, {
        defaultSortBy: 'id',
        defaultSortOrder: 'ASC',
        tieBreakerField: 'id',
      });

      return qb.getMany();
    });
  }
}

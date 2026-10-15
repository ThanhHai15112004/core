import { Injectable, Optional } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { BaseTypeOrmRepository, TransactionManager } from '@packages/database/index.js';
import { OrganizationUnitEntity } from '../entities/organization-unit.entity.js';
import type { ListOrganizationUnitsQuery } from '../requests/organizations.requests.js';

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

  /** Tìm danh sách đơn vị/chi nhánh theo điều kiện lọc */
  public async findFiltered(query: ListOrganizationUnitsQuery): Promise<OrganizationUnitEntity[]> {
    return this.executeReadOnly(async (repo) => {
      const qb = repo.createQueryBuilder('ou').orderBy('ou.id', 'ASC');

      if (query.type !== undefined) {
        qb.andWhere('ou.type = :type', { type: query.type });
      }
      if (query.status !== undefined) {
        qb.andWhere('ou.status = :status', { status: query.status });
      }
      if (query.parentId !== undefined) {
        qb.andWhere('ou.parentId = :parentId', { parentId: query.parentId });
      }
      if (query.search) {
        const keyword = `%${query.search.trim().toLowerCase()}%`;
        qb.andWhere('(LOWER(ou.code) LIKE :keyword OR LOWER(ou.name) LIKE :keyword)', { keyword });
      }

      return qb.getMany();
    });
  }
}
